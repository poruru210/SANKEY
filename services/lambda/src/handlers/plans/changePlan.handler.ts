import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
    APIGatewayClient,
    CreateUsagePlanKeyCommand,
    DeleteUsagePlanKeyCommand,
    GetUsagePlanKeysCommand,
} from '@aws-sdk/client-api-gateway';
import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import httpCors from '@middy/http-cors';
import eventNormalizer from '@middy/http-event-normalizer';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createValidationErrorResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// Powertools instances
const logger = new Logger({ serviceName: 'change-plan' });
const tracer = new Tracer({ serviceName: 'change-plan' });

const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));
const apiGatewayClient = tracer.captureAWSv3Client(new APIGatewayClient({}));

interface ChangePlanRequest {
    userId?: string;
    newTier: string;
}

// メインハンドラー
const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logger.info('Change plan request received');

    try {
        // リクエストボディ解析
        let requestBody: ChangePlanRequest;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch (parseError) {
            return createValidationErrorResponse(
                'Invalid JSON in request body',
                { error: 'Request body must be valid JSON' }
            );
        }

        const { userId, newTier } = requestBody;
        const validTiers = ['free', 'basic', 'pro'];

        // バリデーション
        if (!newTier || !validTiers.includes(newTier)) {
            return createValidationErrorResponse(
                'Invalid or missing tier',
                {
                    received: newTier,
                    validTiers,
                    message: 'Valid tiers: free, basic, pro'
                }
            );
        }

        // API Key ID取得
        const apiKeyId = event.requestContext.authorizer?.claims?.['custom:apiKeyId'];
        if (!apiKeyId) {
            return createUnauthorizedResponse('API Key ID not found in authentication token');
        }

        logger.info('Processing plan change request', {
            userId,
            newTier,
            apiKeyId
        });

        // 新しいプランIDを取得
        const newPlanIdParam = await ssmClient.send(
            new GetParameterCommand({
                Name: `/license-service/usage-plans/${newTier}`,
            })
        );

        if (!newPlanIdParam.Parameter?.Value) {
            return createInternalErrorResponse(
                `${newTier} plan configuration not found`,
                new Error(`Usage plan ${newTier} not found in SSM`)
            );
        }

        const newPlanId = newPlanIdParam.Parameter.Value;

        // 既存のプランから削除
        let removedFromPlan: string | null = null;
        for (const tier of validTiers) {
            try {
                const planIdParam = await ssmClient.send(
                    new GetParameterCommand({
                        Name: `/license-service/usage-plans/${tier}`,
                    })
                );

                if (planIdParam.Parameter?.Value) {
                    const planId = planIdParam.Parameter.Value;

                    const keys = await apiGatewayClient.send(
                        new GetUsagePlanKeysCommand({ usagePlanId: planId })
                    );

                    const isLinked = keys.items?.some((key) => key.id === apiKeyId);
                    if (isLinked) {
                        await apiGatewayClient.send(
                            new DeleteUsagePlanKeyCommand({
                                usagePlanId: planId,
                                keyId: apiKeyId,
                            })
                        );
                        removedFromPlan = tier;
                        logger.info(`Removed API Key from existing plan`, {
                            apiKeyId,
                            removedPlan: tier
                        });
                        break;
                    }
                }
            } catch (error) {
                logger.warn(`No existing link found for ${tier} plan`, {
                    error,
                    tier,
                    apiKeyId
                });
            }
        }

        // 新しいプランに追加
        await apiGatewayClient.send(
            new CreateUsagePlanKeyCommand({
                usagePlanId: newPlanId,
                keyId: apiKeyId,
                keyType: 'API_KEY',
            })
        );

        logger.info('Plan change completed successfully', {
            apiKeyId,
            newTier,
            newPlanId,
            removedFromPlan
        });

        // 統一APIレスポンス形式で返却
        return createSuccessResponse(
            `Successfully changed plan to ${newTier}`,
            {
                apiKeyId,
                newTier,
                usagePlanId: newPlanId,
                previousTier: removedFromPlan,
                changedAt: new Date().toISOString()
            }
        );

    } catch (error) {
        logger.error('Error changing plan', { error });

        return createInternalErrorResponse(
            'Failed to change plan',
            error instanceof Error ? error : new Error(String(error))
        );
    }
};

// Middy ミドルウェアの適用
export const handler = middy(baseHandler)
    .use(httpErrorHandler())
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(eventNormalizer())
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));