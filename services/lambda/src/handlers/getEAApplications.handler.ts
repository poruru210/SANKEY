import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import middy from '@middy/core';
import httpCors from '@middy/http-cors';

// Powertools 初期化
const logger = new Logger();
const tracer = new Tracer();
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ベースハンドラ
const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = event.requestContext.authorizer?.claims?.sub;

        if (!userId) {
            logger.error('No user ID found in authorizer claims');
            return {
                statusCode: 401,
                body: JSON.stringify({ message: 'Unauthorized' }),
            };
        }

        const { Items } = await docClient.send(
            new QueryCommand({
                TableName: process.env.TABLE_NAME,
                KeyConditionExpression: 'userId = :userId AND begins_with(sk, :prefix)',
                ExpressionAttributeValues: {
                    ':userId': userId,
                    ':prefix': 'APPLICATION#',
                },
            })
        );

        const applications =
            Items?.map((item) => ({
                accountNumber: item.accountNumber,
                eaName: item.eaName,
                broker: item.broker,
                email: item.email,
                xAccount: item.xAccount,
                status: item.status,
                appliedAt: item.appliedAt,
                ...(item.licenseKey && { licenseKey: item.licenseKey }),
                ...(item.expiresAt && { expiresAt: item.expiresAt }),
            })) || [];

        return {
            statusCode: 200,
            body: JSON.stringify({
                items: applications,
                count: applications.length,
            }),
        };
    } catch (err) {
        logger.error('Error getting applications', err as Error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Internal server error',
                error: err instanceof Error ? err.message : 'Unknown error',
            }),
        };
    }
};

export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers:
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));
