import { APIGatewayProxyHandler } from 'aws-lambda';
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
import eventNormalizer from '@middy/event-normalizer';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

// Powertools instances
const logger = new Logger({ serviceName: 'license-service' });
const tracer = new Tracer({ serviceName: 'license-service' });

const ssmClient = new SSMClient({});
const apiGatewayClient = new APIGatewayClient({});

// メインハンドラー
const baseHandler: APIGatewayProxyHandler = async (event) => {
    try {
        const { userId, newTier } = JSON.parse(event.body || '{}');
        const validTiers = ['free', 'basic', 'pro'];

        if (!userId || !validTiers.includes(newTier)) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'Invalid userId or tier. Valid tiers: free, basic, pro',
                }),
            };
        }

        const apiKeyId = event.requestContext.authorizer?.claims['custom:apiKeyId'];
        if (!apiKeyId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'API Key ID not found' }),
            };
        }

        const newPlanIdParam = await ssmClient.send(
            new GetParameterCommand({
                Name: `/license-service/usage-plans/${newTier}`,
            })
        );

        if (!newPlanIdParam.Parameter?.Value) {
            return {
                statusCode: 500,
                body: JSON.stringify({ message: `${newTier} plan not found` }),
            };
        }

        const newPlanId = newPlanIdParam.Parameter.Value;

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
                        logger.info(`Removed API Key ${apiKeyId} from ${tier} plan`);
                    }
                }
            } catch (error) {
                logger.warn(`No existing link found for ${tier} plan`, { error });
            }
        }

        await apiGatewayClient.send(
            new CreateUsagePlanKeyCommand({
                usagePlanId: newPlanId,
                keyId: apiKeyId,
                keyType: 'API_KEY',
            })
        );

        logger.info(`Assigned API Key ${apiKeyId} to ${newTier} plan`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Successfully changed plan to ${newTier}`,
                apiKeyId,
                newTier,
                usagePlanId: newPlanId,
            }),
        };
    } catch (error) {
        logger.error('Error changing plan', { error });
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};

// Middy ミドルウェアの適用（Powertools用に専用ミドルウェアを使う）
export const handler = middy(baseHandler)
    .use(httpErrorHandler())
    .use(httpCors())
    .use(eventNormalizer())
    .use(injectLambdaContext(logger))   // Logger context injection
    .use(captureLambdaHandler(tracer)); // Tracer handler capture
