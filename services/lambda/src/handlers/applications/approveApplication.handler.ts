import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { ApproveApplicationHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createForbiddenResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { NotificationMessage } from '../../models/eaApplication';

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
    userId: string,
    dependencies: ApproveApplicationHandlerDependencies
): Promise<any> {
    try {
        const messageBody: NotificationMessage = {
            applicationSK,
            userId
        };

        // 環境変数から遅延時間を取得（デフォルト300秒）
        const delaySeconds = parseInt(process.env.SQS_DELAY_SECONDS || '300', 10);

        const sendParams = {
            QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
            MessageBody: JSON.stringify(messageBody),
            DelaySeconds: delaySeconds  // 環境変数から取得した値を使用
        };

        const result = await dependencies.sqsClient.send(new SendMessageCommand(sendParams));

        dependencies.logger.info('Notification message sent to queue successfully', {
            messageId: result.MessageId,
            applicationSK,
            userId,
            delaySeconds  // ログに遅延時間を追加
        });

        return result;
    } catch (error) {
        dependencies.logger.error('Failed to send notification to queue', {
            error,
            applicationSK,
            userId
        });
        throw error;
    }
}

// ハンドラー作成関数
export const createHandler = (dependencies: ApproveApplicationHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    dependencies.logger.info('Application approval request received');

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
        dependencies.logger.info('Processing approval request', {
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
            dependencies.logger.error('Failed to parse request body', { error: e, body: event.body });
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        const { eaName, expiry, accountId, email, broker } = requestBody;

        // パラメータ検証
        if (!eaName || !expiry || !accountId || !email || !broker) {
            dependencies.logger.error('Missing required parameters', {
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
        const application = await dependencies.eaApplicationRepository.getApplication(userId, fullApplicationSK);
        if (!application) {
            dependencies.logger.error('Application not found', { userId, applicationSK: fullApplicationSK });
            return createNotFoundResponse('Application not found');
        }

        // 権限チェック: 開発者は自分のEAのみ
        if (userRole === 'developer' && application.userId !== userId) {
            dependencies.logger.warn('Developer attempting to approve another user\'s application', {
                requestUserId: userId,
                applicationUserId: application.userId
            });
            return createForbiddenResponse('Access denied: You can only approve your own applications');
        }

        if (application.status !== 'Pending') {
            dependencies.logger.error('Application not in Pending status', {
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
        await dependencies.eaApplicationRepository.updateStatus(userId, fullApplicationSK, 'Approve', {
            eaName,
            email,
            broker,
            expiryDate: expiryDate.toISOString()
        });

        // Step 2: 承認履歴を記録
        await dependencies.eaApplicationRepository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'Approve',
            changedBy: userId,
            previousStatus: 'Pending',
            newStatus: 'Approve',
            reason: `Application approved by ${userRole}: ${userId}`
        });

        dependencies.logger.info('Application approved successfully', {
            userId,
            applicationSK: fullApplicationSK,
            newStatus: 'Approve'
        });

        // Step 3: notificationScheduledAt を計算（5分後）
        const delaySeconds = parseInt(process.env.SQS_DELAY_SECONDS || '300', 10);
        const notificationScheduledAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

        // Step 4: AwaitingNotification ステータスに更新 + notificationScheduledAt設定
        await dependencies.eaApplicationRepository.updateStatus(userId, fullApplicationSK, 'AwaitingNotification', {
            notificationScheduledAt
        });

        // Step 5: AwaitingNotification 履歴を記録
        await dependencies.eaApplicationRepository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'AwaitingNotification',
            changedBy: 'system',
            previousStatus: 'Approve',
            newStatus: 'AwaitingNotification',
            reason: `License generation scheduled for ${notificationScheduledAt}`
        });

        dependencies.logger.info('Application status updated to AwaitingNotification', {
            userId,
            applicationSK: fullApplicationSK,
            notificationScheduledAt
        });

        // 3. SQSに通知メッセージ送信（5分遅延）
        await sendNotificationToQueue(fullApplicationSK, userId, dependencies);

        dependencies.logger.info('License approval process initiated successfully', {
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
        dependencies.logger.error('Error approving application', { error });

        return createInternalErrorResponse('Failed to approve application', error as Error);
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: ApproveApplicationHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    sqsClient: container.resolve('sqsClient'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));