import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import middy from '@middy/core';

import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import {
    NotificationMessage,
    DLQNotificationMessage,
    MAX_RETRY_COUNT,
    isRetryableStatus
} from '../../models/eaApplication';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'dlq-notification'
});

const tracer = new Tracer({ serviceName: 'dlq-notification' });

// DI対応: Repository を初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// DLQメッセージから元のNotificationMessageを抽出
function extractOriginalMessage(dlqRecord: SQSRecord): NotificationMessage | null {
    try {
        // DLQ メッセージの body を解析
        let messageBody = dlqRecord.body;

        // SQS のメッセージが二重にラップされている場合の処理
        if (messageBody.startsWith('{"Type":"Notification"')) {
            // SNS経由の場合
            const snsMessage = JSON.parse(messageBody);
            messageBody = snsMessage.Message;
        }

        // 元の NotificationMessage を取得
        const originalMessage: NotificationMessage = JSON.parse(messageBody);

        // 必須フィールドの検証
        if (!originalMessage.applicationSK || !originalMessage.userId) {
            logger.error('Invalid notification message format', { originalMessage });
            return null;
        }

        return originalMessage;
    } catch (error) {
        logger.error('Failed to extract original message from DLQ record', {
            error,
            recordBody: dlqRecord.body
        });
        return null;
    }
}

// 失敗の詳細情報を抽出
function extractFailureDetails(dlqRecord: SQSRecord): {
    failureReason: string;
    errorDetails: string;
    receiptHandle?: string;
} {
    const attributes = dlqRecord.attributes || {};
    const messageAttributes = dlqRecord.messageAttributes || {};

    // SQS DLQ の標準的な失敗情報
    let failureReason = 'Unknown failure';
    let errorDetails = 'No error details available';

    try {
        // SQSの失敗理由を取得
        if (attributes.ApproximateReceiveCount) {
            const receiveCount = parseInt(attributes.ApproximateReceiveCount, 10);
            failureReason = `Message processing failed after ${receiveCount} attempts`;
        }

        // メッセージ属性からエラー詳細を取得
        if (messageAttributes.errorMessage?.stringValue) {
            errorDetails = messageAttributes.errorMessage.stringValue;
        } else if (messageAttributes.lastErrorMessage?.stringValue) {
            errorDetails = messageAttributes.lastErrorMessage.stringValue;
        }

        // DLQ 固有の情報
        if (attributes.SentTimestamp && attributes.ApproximateFirstReceiveTimestamp) {
            const sentTime = new Date(parseInt(attributes.SentTimestamp, 10));
            const firstReceiveTime = new Date(parseInt(attributes.ApproximateFirstReceiveTimestamp, 10));
            errorDetails += ` | Sent: ${sentTime.toISOString()}, First received: ${firstReceiveTime.toISOString()}`;
        }

    } catch (error) {
        logger.warn('Failed to extract detailed failure information', { error });
    }

    return {
        failureReason,
        errorDetails,
        receiptHandle: dlqRecord.receiptHandle
    };
}

// DLQメッセージ処理
async function processDLQMessage(record: SQSRecord): Promise<void> {
    try {
        logger.info('Processing DLQ message', {
            messageId: record.messageId,
            receiptHandle: record.receiptHandle
        });

        // 元のメッセージを抽出
        const originalMessage = extractOriginalMessage(record);
        if (!originalMessage) {
            logger.error('Cannot process DLQ message: invalid original message format');
            return; // メッセージを破棄
        }

        // 失敗詳細を抽出
        const failureDetails = extractFailureDetails(record);

        logger.info('Extracted failure details', {
            applicationSK: originalMessage.applicationSK,
            userId: originalMessage.userId,
            failureReason: failureDetails.failureReason,
            errorDetails: failureDetails.errorDetails
        });

        // 1. アプリケーションの現在の情報を取得
        const application = await repository.getApplication(
            originalMessage.userId,
            originalMessage.applicationSK
        );

        if (!application) {
            logger.error('Application not found for DLQ processing', {
                userId: originalMessage.userId,
                applicationSK: originalMessage.applicationSK
            });
            return; // メッセージを破棄
        }

        // 2. ステータス確認（AwaitingNotification の場合のみ処理）
        if (application.status !== 'AwaitingNotification') {
            logger.warn('Application is not in AwaitingNotification status, skipping DLQ processing', {
                userId: originalMessage.userId,
                applicationSK: originalMessage.applicationSK,
                currentStatus: application.status
            });
            return;
        }

        // 3. 失敗回数をカウント
        const currentFailureCount = (application.failureCount || 0) + 1;
        const retryCount = originalMessage.retryCount || 0;

        logger.info('Updating application to FailedNotification status', {
            userId: originalMessage.userId,
            applicationSK: originalMessage.applicationSK,
            currentFailureCount,
            retryCount,
            maxRetryCount: MAX_RETRY_COUNT
        });

        // 4. ステータスを FailedNotification に更新
        await repository.updateStatus(
            originalMessage.userId,
            originalMessage.applicationSK,
            'FailedNotification',
            {
                lastFailureReason: failureDetails.failureReason,
                failureCount: currentFailureCount,
                lastFailedAt: new Date().toISOString()
            }
        );

        // 5. 履歴記録
        await repository.recordHistory({
            userId: originalMessage.userId,
            applicationSK: originalMessage.applicationSK,
            action: 'EmailFailed',
            changedBy: 'system',
            previousStatus: 'AwaitingNotification',
            newStatus: 'FailedNotification',
            reason: `Email notification failed: ${failureDetails.failureReason}`,
            errorDetails: failureDetails.errorDetails,
            retryCount: currentFailureCount
        });

        logger.info('DLQ processing completed successfully', {
            userId: originalMessage.userId,
            applicationSK: originalMessage.applicationSK,
            newStatus: 'FailedNotification',
            failureCount: currentFailureCount,
            canRetry: currentFailureCount < MAX_RETRY_COUNT
        });

        // 6. 管理者通知（オプション）
        if (currentFailureCount >= MAX_RETRY_COUNT) {
            logger.error('Maximum retry count reached, manual intervention required', {
                userId: originalMessage.userId,
                applicationSK: originalMessage.applicationSK,
                failureCount: currentFailureCount,
                eaName: application.eaName,
                email: application.email
            });

            // TODO: 管理者へのアラート送信（SNS、Slack、メールなど）
            // await sendAdminAlert({
            //     severity: 'HIGH',
            //     message: `License notification failed ${currentFailureCount} times`,
            //     application: application,
            //     lastError: failureDetails.errorDetails
            // });
        }

    } catch (error) {
        logger.error('Failed to process DLQ message', {
            error,
            record: record.body,
            messageId: record.messageId
        });

        // DLQ処理でエラーが発生した場合、メッセージを再度失敗させる
        // （別の DLQ や監視アラートでキャッチするため）
        throw error;
    }
}

// メインハンドラ
const baseHandler = async (event: SQSEvent): Promise<void> => {
    logger.info('DLQ notification handler started', {
        recordCount: event.Records.length
    });

    // DLQ処理は並列実行せず、順次処理する（安全性のため）
    for (const record of event.Records) {
        try {
            await processDLQMessage(record);
        } catch (error) {
            logger.error('DLQ message processing failed', {
                error,
                messageId: record.messageId
            });

            // 個別のメッセージ失敗でもハンドラー全体は継続
            // ただし、重要なエラーの場合は例外を投げることも可能
        }
    }

    logger.info('DLQ notification handler completed');
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger, {
        logEvent: true,
    }))
    .use(captureLambdaHandler(tracer));