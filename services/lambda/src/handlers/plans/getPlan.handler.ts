import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import httpCors from '@middy/http-cors';
import eventNormalizer from '@middy/http-event-normalizer';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
    APIGatewayClient,
    GetUsagePlanKeysCommand,
    GetUsagePlansCommand,
    GetApiKeyCommand
} from '@aws-sdk/client-api-gateway';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createValidationErrorResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

const logger = new Logger({ serviceName: 'get-plan' });
const tracer = new Tracer({ serviceName: 'get-plan' });

const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));
const apiGatewayClient = tracer.captureAWSv3Client(new APIGatewayClient({}));

const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logger.info('Get plan request received');

    try {
        const apiKeyId = event.requestContext.authorizer?.claims?.['custom:apiKeyId'];
        if (!apiKeyId) {
            return createValidationErrorResponse(
                'API Key ID not found in token',
                { parameter: 'custom:apiKeyId', source: 'JWT claims' }
            );
        }

        logger.info('Processing get plan request', { apiKeyId });

        // API Key情報取得
        const apiKeyInfo = await apiGatewayClient.send(new GetApiKeyCommand({
            apiKey: apiKeyId,
            includeValue: false
        }));

        const validTiers = ['free', 'basic', 'pro'];
        let currentTier: string | null = null;
        let currentPlanId: string | null = null;
        let planDetails = null;

        // 現在のプランを特定
        for (const tier of validTiers) {
            try {
                const planIdParam = await ssmClient.send(new GetParameterCommand({
                    Name: `/license-service/usage-plans/${tier}`
                }));

                const planId = planIdParam.Parameter?.Value;
                if (!planId) continue;

                const keys = await apiGatewayClient.send(new GetUsagePlanKeysCommand({
                    usagePlanId: planId
                }));

                const isLinked = keys.items?.some(key => key.id === apiKeyId);
                if (isLinked) {
                    currentTier = tier;
                    currentPlanId = planId;
                    const plans = await apiGatewayClient.send(new GetUsagePlansCommand());
                    planDetails = plans.items?.find(plan => plan.id === planId);
                    break;
                }
            } catch (error) {
                logger.warn(`Error checking ${tier} plan`, { error, tier });
            }
        }

        // レスポンスデータ構築
        const planInfo = {
            currentTier,
            apiKeyId,
            apiKeyName: apiKeyInfo.name,
            usagePlanId: currentPlanId,
            limits: planDetails ? {
                rateLimit: planDetails.throttle?.rateLimit || 0,
                burstLimit: planDetails.throttle?.burstLimit || 0,
                quotaLimit: planDetails.quota?.limit || 0,
                quotaPeriod: planDetails.quota?.period || 'MONTH',
            } : null,
        };

        const availablePlans = {
            free: { rateLimit: 2, burstLimit: 5, quotaLimit: 100, quotaPeriod: 'MONTH' },
            basic: { rateLimit: 10, burstLimit: 20, quotaLimit: 1000, quotaPeriod: 'MONTH' },
            pro: { rateLimit: 50, burstLimit: 100, quotaLimit: 10000, quotaPeriod: 'MONTH' },
        };

        logger.info('Plan information retrieved successfully', {
            apiKeyId,
            currentTier,
            currentPlanId
        });

        // 統一APIレスポンス形式で返却
        return createSuccessResponse(
            'Plan information retrieved successfully',
            {
                current: planInfo,
                available: availablePlans,
            }
        );

    } catch (error) {
        logger.error('Error retrieving plan information', { error });

        return createInternalErrorResponse(
            'Failed to retrieve plan information',
            error instanceof Error ? error : new Error(String(error))
        );
    }
};

// middy ラッパーを適用
export const handler = middy(baseHandler)
    .use(httpErrorHandler())
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(eventNormalizer())
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));