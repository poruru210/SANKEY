import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { RejectApplicationHandlerDependencies } from '../../di/dependencies';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createForbiddenResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// リクエストボディ型定義
interface RejectRequest {
    reason?: string;
}

// ハンドラー作成関数
export const createHandler = (dependencies: RejectApplicationHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    dependencies.logger.info('Reject application request received');

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
        dependencies.logger.info('Processing reject application request', {
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
                dependencies.logger.warn('Failed to parse request body, proceeding without reason', { error: e });
            }
        }

        const { reason } = requestBody;

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
            dependencies.logger.warn('Developer attempting to reject another user\'s application', {
                requestUserId: userId,
                applicationUserId: application.userId
            });
            return createForbiddenResponse('Access denied: You can only reject your own applications');
        }

        // 2. ステータス確認
        if (application.status !== 'Pending') {
            dependencies.logger.error('Application not in Pending status', {
                userId,
                applicationSK: fullApplicationSK,
                currentStatus: application.status
            });
            return createValidationErrorResponse(
                `Application is in ${application.status} status. Only Pending applications can be rejected.`
            );
        }

        // 3. ステータス更新
        await dependencies.eaApplicationRepository.updateStatus(userId, fullApplicationSK, 'Rejected');

        // 4. 履歴記録
        const rejectionReason = reason || `Application rejected by ${userRole}: ${userId}`;
        await dependencies.eaApplicationRepository.recordHistory({
            userId,
            applicationSK: fullApplicationSK,
            action: 'Rejected',
            changedBy: userId,
            previousStatus: 'Pending',
            newStatus: 'Rejected',
            reason: rejectionReason
        });

        dependencies.logger.info('Application rejected successfully', {
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
        dependencies.logger.error('Error rejecting application', { error });
        return createInternalErrorResponse('Failed to reject application', error as Error);
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: RejectApplicationHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
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