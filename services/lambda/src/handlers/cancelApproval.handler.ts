import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

const logger = new Logger({ serviceName: 'cancel-approval' });
const tracer = new Tracer({ serviceName: 'cancel-approval' });

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// DynamoDBからアプリケーション取得
async function getApplication(applicationKey: string, userId: string) {
    try {
        const response = await dynamoClient.send(
            new GetCommand({
                TableName: process.env.TABLE_NAME!,
                Key: {
                    userId,
                    sk: applicationKey,
                },
            })
        );

        return response.Item;
    } catch (error) {
        logger.error('Failed to get application', { error, applicationKey, userId });
        throw error;
    }
}

// アプリケーション取り消し
async function cancelApplication(applicationKey: string, userId: string) {
    try {
        await dynamoClient.send(
            new UpdateCommand({
                TableName: process.env.TABLE_NAME!,
                Key: {
                    userId,
                    sk: applicationKey,
                },
                UpdateExpression: 'SET #status = :status, cancelledAt = :cancelledAt, updatedAt = :updatedAt',
                ExpressionAttributeNames: {
                    '#status': 'status',
                },
                ExpressionAttributeValues: {
                    ':status': 'Cancelled',
                    ':cancelledAt': new Date().toISOString(),
                    ':updatedAt': new Date().toISOString(),
                    ':expectedStatus': 'AwaitingNotification',
                },
                // 取り消し可能な状態かチェック
                ConditionExpression: '#status = :expectedStatus',
            })
        );

        logger.info('Application cancelled successfully', { applicationKey, userId });
    } catch (error) {
        logger.error('Failed to cancel application', { error, applicationKey, userId });
        throw error;
    }
}

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    logger.info('Cancel approval request received');

    try {
        // パスパラメータからapplicationKeyを取得
        const applicationKey = event.pathParameters?.applicationKey;
        if (!applicationKey) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Missing applicationKey parameter',
                }),
            };
        }

        // デコード
        const decodedKey = decodeURIComponent(applicationKey);

        // ユーザーIDを認証情報から取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: 'Unauthorized',
                }),
            };
        }

        logger.info('Processing cancel request', {
            applicationKey: decodedKey,
            userId,
        });

        // アプリケーション存在確認
        const application = await getApplication(decodedKey, userId);
        if (!application) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: 'Application not found',
                }),
            };
        }

        // ステータス確認（取り消し可能かチェック）
        if (application.status !== 'AwaitingNotification') {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Application cannot be cancelled',
                    message: `Current status: ${application.status}. Only AwaitingNotification status can be cancelled.`,
                    currentStatus: application.status,
                }),
            };
        }

        // 5分以内かチェック（追加の安全措置）
        const approvedAt = new Date(application.approvedAt || application.updatedAt);
        const now = new Date();
        const timeDiff = now.getTime() - approvedAt.getTime();
        const fiveMinutesInMs = 5 * 60 * 1000;

        if (timeDiff > fiveMinutesInMs) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Cancellation period expired',
                    message: 'Applications can only be cancelled within 5 minutes of approval.',
                }),
            };
        }

        // アプリケーション取り消し実行
        await cancelApplication(decodedKey, userId);

        logger.info('Application cancelled successfully', {
            applicationKey: decodedKey,
            userId,
            eaName: application.eaName,
            accountNumber: application.accountNumber,
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Application approval cancelled successfully',
                applicationKey: decodedKey,
                eaName: application.eaName,
                accountNumber: application.accountNumber,
                cancelledAt: new Date().toISOString(),
            }),
        };

    } catch (error) {
        logger.error('Error cancelling application approval', { error });

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: 'Failed to cancel application approval',
            }),
        };
    }
};

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));