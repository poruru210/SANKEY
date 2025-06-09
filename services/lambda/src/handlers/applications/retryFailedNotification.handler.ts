import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { NotificationMessage, MAX_RETRY_COUNT } from '../../models/eaApplication';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createForbiddenResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'retry-failed-notification'
});

const tracer = new Tracer({ serviceName: 'retry-failed-notification' });

// DI対応: Repository とクライアントを初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

const sqsClient = new SQSClient({});

// リクエストボディの型定義
interface RetryRequest {
    reason?: string;
    force?: boolean; // 最大リトライ回数を超えていても強制実行
}

// SQSに通知メッセージ再送信
async function sendRetryNotificationToQueue(
    applicationSK: string,
    userId: string,
    retryCount: number = 0
): Promise<void> {
    try {
        const messageBody: NotificationMessage = {
            applicationSK,
            userId,
            retryCount
        };

        // 環境変数から遅延時間を取得（デフォルト300秒）
        const delaySeconds = parseInt(process.env.SQS_DELAY_SECONDS || '300', 10);

        const sendParams = {
            QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
            MessageBody: JSON.stringify(messageBody),
            DelaySeconds: delaySeconds,
            MessageAttributes: {
                retryAttempt: {
                    DataType: 'Number',
                    StringValue: retryCount.toString()
                },
                isRetry: {
                    DataType: 'String',
                    StringValue: 'true'
                }
            }
        };

        const result = await sqsClient.send(new SendMessageCommand(sendParams));

        logger.info('Retry notification message sent to queue successfully', {
            messageId: result.MessageId,
            applicationSK,
            userId,
            retryCount,
            delaySeconds
        });

    } catch (error) {
        logger.error('Failed to send retry notification to queue', {
            error,
            applicationSK,
            userId,
            retryCount
        });
        throw error;
    }
}

// 単一アプリケーションのリトライ処理
async function handleSingleRetry(
    event: APIGatewayProxyEvent,
    userId: string,
    applicationId: string
): Promise<APIGatewayProxyResult> {
    const decodedApplicationId = decodeURIComponent(applicationId);

    // SK形式に変換
    let fullApplicationKey = decodedApplicationId;
    if (!decodedApplicationId.startsWith('APPLICATION#')) {
        fullApplicationKey = `APPLICATION#${decodedApplicationId}`;
    }

    logger.info('Processing single application retry', {
        userId,
        applicationId: fullApplicationKey
    });

    // リクエストボディの解析（オプション）
    let requestBody: RetryRequest = {};
    if (event.body) {
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            logger.warn('Failed to parse request body, proceeding with defaults', { error: e });
        }
    }

    const { reason = 'Manual retry requested', force = false } = requestBody;

    try {
        // アプリケーション情報を取得
        const application = await repository.getApplication(userId, fullApplicationKey);
        if (!application) {
            logger.error('Application not found', { userId, applicationId: fullApplicationKey });
            return createNotFoundResponse('Application not found');
        }

        // ステータス確認
        if (application.status !== 'FailedNotification') {
            return createValidationErrorResponse(
                `Cannot retry notification for application in ${application.status} status. Expected FailedNotification.`
            );
        }

        // リトライ回数確認
        const currentFailureCount = application.failureCount || 0;
        if (!force && currentFailureCount >= MAX_RETRY_COUNT) {
            return createValidationErrorResponse(
                `Maximum retry count (${MAX_RETRY_COUNT}) exceeded. Use force=true to override.`,
                {
                    currentFailureCount,
                    maxRetryCount: MAX_RETRY_COUNT,
                    lastFailureReason: application.lastFailureReason
                }
            );
        }

        // リトライ実行
        await repository.retryFailedNotification(userId, fullApplicationKey, reason);

        // SQSに再送信
        await sendRetryNotificationToQueue(fullApplicationKey, userId, currentFailureCount + 1);

        logger.info('Failed notification retry initiated successfully', {
            userId,
            applicationId: fullApplicationKey,
            eaName: application.eaName,
            email: application.email,
            previousFailureCount: currentFailureCount,
            reason
        });

        return createSuccessResponse('Failed notification retry initiated successfully', {
            applicationId: decodedApplicationId,
            status: 'AwaitingNotification',
            eaName: application.eaName,
            email: application.email,
            previousFailureCount: currentFailureCount,
            retryCount: currentFailureCount + 1,
            reason,
            message: 'Notification will be retried in 5 minutes'
        });

    } catch (error) {
        logger.error('Error retrying failed notification', { error, userId, applicationId: fullApplicationKey });
        return createInternalErrorResponse('Failed to retry notification', error as Error);
    }
}

// バッチリトライ処理
async function handleBatchRetry(
    event: APIGatewayProxyEvent,
    userId: string
): Promise<APIGatewayProxyResult> {
    logger.info('Processing batch retry for user', { userId });

    // リクエストボディの解析
    let requestBody: RetryRequest & { maxApplications?: number } = {};
    if (event.body) {
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            return createValidationErrorResponse('Invalid JSON in request body');
        }
    }

    const {
        reason = 'Batch retry requested',
        force = false,
        maxApplications = 10 // 一度に処理する最大件数
    } = requestBody;

    try {
        // リトライ可能な失敗通知を取得
        let failedApps = force
            ? await repository.getFailedNotificationApplications(userId)
            : await repository.getRetryableFailedNotifications(userId);

        if (failedApps.length === 0) {
            return createSuccessResponse('No failed notifications found for retry', {
                retryCount: 0,
                message: force
                    ? 'No failed notifications found'
                    : 'No retryable failed notifications found (use force=true to retry all)'
            });
        }

        // 最大処理件数で制限
        if (failedApps.length > maxApplications) {
            failedApps = failedApps.slice(0, maxApplications);
            logger.info('Limited batch retry to maximum applications', {
                totalFailed: failedApps.length,
                maxApplications
            });
        }

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        // 各アプリケーションを順次処理（並列処理は避ける）
        for (const app of failedApps) {
            try {
                await repository.retryFailedNotification(userId, app.sk, reason);
                await sendRetryNotificationToQueue(app.sk, userId, (app.failureCount || 0) + 1);

                results.push({
                    applicationId: app.sk,
                    eaName: app.eaName,
                    status: 'success',
                    previousFailureCount: app.failureCount || 0
                });
                successCount++;

                logger.info('Batch retry success for application', {
                    applicationId: app.sk,
                    eaName: app.eaName
                });

            } catch (error) {
                results.push({
                    applicationId: app.sk,
                    eaName: app.eaName,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
                errorCount++;

                logger.error('Batch retry failed for application', {
                    applicationId: app.sk,
                    eaName: app.eaName,
                    error
                });
            }

            // レート制限のための小さな遅延
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.info('Batch retry completed', {
            userId,
            totalProcessed: results.length,
            successCount,
            errorCount
        });

        return createSuccessResponse('Batch retry completed', {
            summary: {
                totalProcessed: results.length,
                successCount,
                errorCount,
                reason
            },
            results
        });

    } catch (error) {
        logger.error('Error in batch retry process', { error, userId });
        return createInternalErrorResponse('Failed to process batch retry', error as Error);
    }
}

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('Retry failed notification request received');

    try {
        // 認証情報から userId を取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User authentication required');
        }

        // 権限チェック（必要に応じて管理者権限も追加）
        const userRole = event.requestContext.authorizer?.claims?.role || 'developer';
        logger.info('Processing retry request', {
            userId,
            userRole,
        });

        // パスパラメータの有無で処理を分岐
        const applicationId = event.pathParameters?.id;
        if (applicationId) {
            // 単一アプリケーションのリトライ
            return await handleSingleRetry(event, userId, applicationId);
        } else {
            // バッチリトライ
            return await handleBatchRetry(event, userId);
        }

    } catch (error) {
        logger.error('Error in main handler', { error });
        return createInternalErrorResponse('Failed to process retry request', error as Error);
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