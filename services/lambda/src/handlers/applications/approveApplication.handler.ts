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
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createForbiddenResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { NotificationMessage } from '../../models/eaApplication';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'approve-application'
});

const tracer = new Tracer({ serviceName: 'approve-application' });

// DI対応: Repository とクライアントを初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

const sqsClient = new SQSClient({});

// RESTful版のリクエスト形式
interface ApprovalRequest {
    eaName: string;
    accountId: string;
    expiry: string;
    email: string;
    broker: string;
}

// SQSに通知メッセージ送信
async function sendNotificationToQueue(
    applicationSK: string,
    userId: string
) {
    try {
        const messageBody: NotificationMessage = {
            applicationSK,
            userId
        };

        const sendParams = {
            QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
            MessageBody: JSON.stringify(messageBody),
            DelaySeconds: 300 // 5分遅延
        };

        const result = await sqsClient.send(new SendMessageCommand(sendParams));

        logger.info('Notification message sent to queue successfully', {
            messageId: result.MessageId,
            applicationSK,
            userId
        });

        return result;
    } catch (error) {
        logger.error('Failed to send notification to queue', {
            error,
            applicationSK,
            userId
        });
        throw error;
    }
}

// ベースハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('Application approval request received');

    try {
        // RESTful: パスパラメータから ID を取得
        const applicationId = event.pathParameters?.id;
        if (!applicationId) {
            return createValidationErrorResponse('Application ID is required');
        }

        // デコード
        const decodedApplicationId = decodeURIComponent(applicationId);

        // 認証情報から userId を取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse();
        }

        // 権限チェック（開発者は自分のEAのみ、管理者は全て）
        const userRole = event.requestContext.authorizer?.claims?.role || 'developer';
        logger.info('Processing approval request', {
            applicationId: decodedApplicationId,
            userId,
            userRole,
        });

        // リクエストボディの解析
        if (!event.body) {
            return createValidationErrorResponse('Request body is required');
        }

        let requestBody: ApprovalRequest;
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            logger.error('Failed to parse request body', { error: e, body: event.body });
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        const { eaName, expiry, accountId, email, broker } = requestBody;

        // パラメータ検証
        if (!eaName || !expiry || !accountId || !email || !broker) {
            logger.error('Missing required parameters', {
                eaName: !!eaName,
                expiry: !!expiry,
                accountId: !!accountId,
                email: !!email,
                broker: !!broker,
            });

            return createValidationErrorResponse(
                'Missing required parameters: eaName, expiry, accountId, email, broker'
            );
        }

        // 有効期限検証
        const expiryDate = new Date(expiry);
        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
            return createValidationErrorResponse('Invalid expiry date. Must be a valid future date');
        }

        // アプリケーション ID を SK 形式に変換（既存システムとの互換性）
        let fullApplicationSK = decodedApplicationId;
        if (!decodedApplicationId.startsWith('APPLICATION#')) {
            fullApplicationSK = `APPLICATION#${decodedApplicationId}`;
        }

        // 1. アプリケーション情報を取得して検証
        const application = await repository.getApplication(userId, fullApplicationSK);
        if (!application) {
            logger.error('Application not found', { userId, applicationSK: fullApplicationSK });
            return createNotFoundResponse('Application not found');
        }

        // 権限チェック: 開発者は自分のEAのみ
        if (userRole === 'developer' && application.userId !== userId) {
            logger.warn('Developer attempting to approve another user\'s application', {
                requestUserId: userId,
                applicationUserId: application.userId
            });
            return createForbiddenResponse('Access denied: You can only approve your own applications');
        }

        if (application.status !== 'Pending') {
            logger.error('Application not in Pending status', {
                userId,
                applicationSK: fullApplicationSK,
                currentStatus: application.status
            });
            return createValidationErrorResponse(
                `Application is in ${application.status} status, expected Pending`
            );
        }

        // 2. 新しいステータス遷移: Pending → Approve → AwaitingNotification
        // Step 1: Approve ステータスに更新
        await repository.updateStatus(userId, fullApplicationSK, 'Approve', {
            eaName,
            email,
            broker,
            expiryDate: expiryDate.toISOString()
        });

        // Step 2: 承認履歴を記録
        await repository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'Approve',
            changedBy: userId,
            previousStatus: 'Pending',
            newStatus: 'Approve',
            reason: `Application approved by ${userRole}: ${userId}`
        });

        logger.info('Application approved successfully', {
            userId,
            applicationSK: fullApplicationSK,
            newStatus: 'Approve'
        });

        // Step 3: notificationScheduledAt を計算（5分後）
        const notificationScheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        // Step 4: AwaitingNotification ステータスに更新 + notificationScheduledAt設定
        await repository.updateStatus(userId, fullApplicationSK, 'AwaitingNotification', {
            notificationScheduledAt
        });

        // Step 5: AwaitingNotification 履歴を記録
        await repository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'AwaitingNotification',
            changedBy: 'system',
            previousStatus: 'Approve',
            newStatus: 'AwaitingNotification',
            reason: `License generation scheduled for ${notificationScheduledAt}`
        });

        logger.info('Application status updated to AwaitingNotification', {
            userId,
            applicationSK: fullApplicationSK,
            notificationScheduledAt
        });

        // 3. SQSに通知メッセージ送信（5分遅延）
        await sendNotificationToQueue(fullApplicationSK, userId);

        logger.info('License approval process initiated successfully', {
            userId,
            accountId,
            eaName,
            status: 'AwaitingNotification',
            notificationScheduled: true
        });

        // RESTful レスポンス
        return createSuccessResponse('Application approved successfully', {
            applicationId: decodedApplicationId,
            status: 'AwaitingNotification',
            notificationScheduledAt,
            eaName,
            accountId,
            email,
            message: 'License will be generated and sent via email in 5 minutes'
        });

    } catch (error) {
        logger.error('Error approving application', { error });

        return createInternalErrorResponse('Failed to approve application', error as Error);
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