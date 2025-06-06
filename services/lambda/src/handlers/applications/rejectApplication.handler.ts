import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

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

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'reject-application'
});

const tracer = new Tracer({ serviceName: 'reject-application' });

// DI対応: Repository を初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// リクエストボディ型定義
interface RejectRequest {
    reason?: string;
}

// ベースハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('Reject application request received');

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
        logger.info('Processing reject application request', {
            applicationId: decodedApplicationId,
            userId,
            userRole,
        });

        // リクエストボディの解析（オプション）
        let requestBody: RejectRequest = {};
        if (event.body) {
            try {
                requestBody = JSON.parse(event.body);
            } catch (e) {
                logger.warn('Failed to parse request body, proceeding without reason', { error: e });
            }
        }

        const { reason } = requestBody;

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
            logger.warn('Developer attempting to reject another user\'s application', {
                requestUserId: userId,
                applicationUserId: application.userId
            });
            return createForbiddenResponse('Access denied: You can only reject your own applications');
        }

        // 2. ステータス確認
        if (application.status !== 'Pending') {
            logger.error('Application not in Pending status', {
                userId,
                applicationSK: fullApplicationSK,
                currentStatus: application.status
            });
            return createValidationErrorResponse(
                `Application is in ${application.status} status. Only Pending applications can be rejected.`
            );
        }

        // 3. ステータス更新
        await repository.updateStatus(userId, fullApplicationSK, 'Rejected');

        // 4. 履歴記録
        const rejectionReason = reason || `Application rejected by ${userRole}: ${userId}`;
        await repository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'Rejected',
            changedBy: userId,
            previousStatus: 'Pending',
            newStatus: 'Rejected',
            reason: rejectionReason
        });

        logger.info('Application rejected successfully', {
            userId,
            applicationSK: fullApplicationSK,
            eaName: application.eaName,
            accountNumber: application.accountNumber,
            reason: rejectionReason
        });

        // RESTful レスポンス
        return createSuccessResponse('Application rejected successfully', {
            applicationId: decodedApplicationId,
            status: 'Rejected',
            eaName: application.eaName,
            accountNumber: application.accountNumber,
            reason: rejectionReason,
            message: 'Application has been rejected'
        });

    } catch (error) {
        logger.error('Error rejecting application', { error });
        return createInternalErrorResponse('Failed to reject application', error as Error);
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