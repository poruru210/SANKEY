import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createProductionContainer } from '../../di/container';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import type { RevokeLicenseHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createForbiddenResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// リクエストボディ型定義
interface RevokeRequest {
    reason?: string;
}

// ハンドラーファクトリー（必須）
export const createHandler = (deps: RevokeLicenseHandlerDependencies) => {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        deps.logger.info('Revoke license request received');

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
            deps.logger.info('Processing revoke license request', {
                applicationId: decodedApplicationId,
                userId,
                userRole,
            });

            // リクエストボディの解析（オプション）
            let requestBody: RevokeRequest = {};
            if (event.body) {
                try {
                    requestBody = JSON.parse(event.body);
                } catch (e) {
                    deps.logger.warn('Failed to parse request body, proceeding without reason', { error: e });
                }
            }

            const { reason } = requestBody;

            // アプリケーション ID を SK 形式に変換（既存システムとの互換性）
            let fullApplicationSK = decodedApplicationId;
            if (!decodedApplicationId.startsWith('APPLICATION#')) {
                fullApplicationSK = `APPLICATION#${decodedApplicationId}`;
            }

            // 1. アプリケーション情報を取得して検証
            const application = await deps.eaApplicationRepository.getApplication(userId, fullApplicationSK);
            if (!application) {
                deps.logger.error('Application not found', { userId, applicationSK: fullApplicationSK });
                return createNotFoundResponse('Application not found');
            }

            // 権限チェック: 開発者は自分のEAのみ
            if (userRole === 'developer' && application.userId !== userId) {
                deps.logger.warn('Developer attempting to revoke another user\'s license', {
                    requestUserId: userId,
                    applicationUserId: application.userId
                });
                return createForbiddenResponse('Access denied: You can only revoke your own licenses');
            }

            // 2. ステータス確認
            if (application.status !== 'Active') {
                deps.logger.error('Application not in Active status', {
                    userId,
                    applicationSK: fullApplicationSK,
                    currentStatus: application.status
                });
                return createValidationErrorResponse(
                    `Application is in ${application.status} status. Only Active licenses can be revoked.`
                );
            }

            // 3. ライセンスキーの確認
            if (!application.licenseKey) {
                deps.logger.error('No license key found for application', {
                    userId,
                    applicationSK: fullApplicationSK
                });
                return createValidationErrorResponse('No license key found for this application');
            }

            // 4. ステータス更新
            await deps.eaApplicationRepository.updateStatus(userId, fullApplicationSK, 'Revoked');

            // 5. 履歴記録
            const revocationReason = reason || `License revoked by ${userRole}: ${userId}`;
            await deps.eaApplicationRepository.recordHistory({
                userId,
                applicationSK: fullApplicationSK,
                action: 'Revoked',
                changedBy: userId,
                previousStatus: 'Active',
                newStatus: 'Revoked',
                reason: revocationReason
            });

            deps.logger.info('License revoked successfully', {
                userId,
                applicationSK: fullApplicationSK,
                eaName: application.eaName,
                accountNumber: application.accountNumber,
                reason: revocationReason
            });

            // RESTful レスポンス
            return createSuccessResponse('License revoked successfully', {
                applicationId: decodedApplicationId,
                status: 'Revoked',
                eaName: application.eaName,
                accountNumber: application.accountNumber,
                licenseKey: application.licenseKey.substring(0, 10) + '...', // セキュリティのため一部のみ表示
                reason: revocationReason,
                message: 'License has been revoked and is no longer valid'
            });

        } catch (error) {
            deps.logger.error('Error revoking license', { error });
            return createInternalErrorResponse('Failed to revoke license', error as Error);
        }
    };
};

// Production設定（必須）
const container = createProductionContainer();
const dependencies: RevokeLicenseHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// Middleware適用（必須）
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));