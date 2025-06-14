import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createProductionContainer } from '../../di/container';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { decryptLicense } from '../../services/encryption';
import { LicensePayloadV1 } from '../../models/licensePayload';
import type { DecryptLicenseHandlerDependencies } from '../../di/dependencies';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse,
    createNotFoundResponse
} from '../../utils/apiResponse';

// ハンドラーファクトリー（必須）
export const createHandler = (deps: DecryptLicenseHandlerDependencies) => {
    // 任意のライセンス文字列を直接復号化
    const handleDirectDecrypt = async (
        event: APIGatewayProxyEvent,
        userId: string
    ): Promise<APIGatewayProxyResult> => {
        deps.logger.info('Processing direct license decrypt request', { userId });

        // リクエストボディの取得・パース
        if (!event.body) {
            return createValidationErrorResponse('Request body is required');
        }

        let requestBody;
        try {
            requestBody = JSON.parse(event.body);
        } catch (error) {
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        // 必須項目のバリデーション
        const { encryptedLicense, accountId } = requestBody;
        if (!encryptedLicense) {
            return createValidationErrorResponse('encryptedLicense is required');
        }
        if (!accountId) {
            return createValidationErrorResponse('accountId is required');
        }

        try {
            // 共通サービスを使用してマスターキーを取得
            const masterKey = await deps.masterKeyService.getUserMasterKeyForDecryption(userId);

            // ライセンスを復号化
            let decryptedPayload: LicensePayloadV1;
            try {
                decryptedPayload = await decryptLicense(masterKey, encryptedLicense, accountId);
            } catch (error) {
                deps.logger.error('Failed to decrypt license', {
                    error,
                    userId,
                    accountId
                });
                return createValidationErrorResponse('Failed to decrypt license - invalid license key or data corruption');
            }

            deps.logger.info('License decrypted successfully', {
                userId,
                accountId,
                eaName: decryptedPayload.eaName,
                expiry: decryptedPayload.expiry,
                version: decryptedPayload.version
            });

            // 復号化されたライセンス情報を返却
            return createSuccessResponse('License decrypted successfully', {
                decryptedLicense: decryptedPayload
            });

        } catch (error) {
            deps.logger.error('Error in direct decrypt process', { error, userId });
            return createInternalErrorResponse('Failed to decrypt license', error as Error);
        }
    };

    // 既存のアプリケーションIDベース復号化
    const handleApplicationDecrypt = async (
        event: APIGatewayProxyEvent,
        userId: string,
        applicationId: string
    ): Promise<APIGatewayProxyResult> => {
        const decodedApplicationId = decodeURIComponent(applicationId);

        // SK形式に変換
        let fullApplicationKey = decodedApplicationId;
        if (!decodedApplicationId.startsWith('APPLICATION#')) {
            fullApplicationKey = `APPLICATION#${decodedApplicationId}`;
        }

        deps.logger.info('Processing license decrypt request', {
            userId,
            applicationId: fullApplicationKey
        });

        try {
            // DI対応のRepositoryを使用
            const application = await deps.eaApplicationRepository.getApplication(userId, fullApplicationKey);
            if (!application) {
                deps.logger.error('Application not found', { userId, applicationId: fullApplicationKey });
                return createNotFoundResponse('Application not found');
            }

            // 必要なデータの存在確認
            if (!application.accountNumber) {
                deps.logger.error('Account number not found in application', { userId, applicationId: fullApplicationKey });
                return createValidationErrorResponse('Account number not found in application');
            }

            if (!application.licenseKey) {
                deps.logger.error('License key not found in application', { userId, applicationId: fullApplicationKey });
                return createValidationErrorResponse('License key not found in application');
            }

            // アプリケーションステータス確認を削除
            // ステータスに関係なく復号化を実行
            deps.logger.info('Application status check bypassed - allowing decryption for all statuses', {
                userId,
                applicationId: fullApplicationKey,
                currentStatus: application.status
            });

            // 共通サービスを使用してマスターキーを取得
            const masterKey = await deps.masterKeyService.getUserMasterKeyForDecryption(userId);

            // DBに保存されているライセンスキーを復号化
            let decryptedPayload: LicensePayloadV1;
            try {
                decryptedPayload = await decryptLicense(masterKey, application.licenseKey!, application.accountNumber);
            } catch (error) {
                deps.logger.error('Failed to decrypt license', {
                    error,
                    userId,
                    applicationId: fullApplicationKey,
                    accountNumber: application.accountNumber
                });
                return createValidationErrorResponse('Failed to decrypt license - invalid license key or data corruption');
            }

            deps.logger.info('License decrypted successfully', {
                userId,
                applicationId: fullApplicationKey,
                accountNumber: application.accountNumber,
                eaName: decryptedPayload.eaName,
                expiry: decryptedPayload.expiry,
                version: decryptedPayload.version,
                status: application.status
            });

            // 復号化されたライセンス情報を返却
            return createSuccessResponse('License decrypted successfully', {
                decryptedLicense: decryptedPayload
            });

        } catch (error) {
            deps.logger.error('Error decrypting license', { error });
            return createInternalErrorResponse('Failed to decrypt license', error as Error);
        }
    };

    // メインハンドラ
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        deps.logger.info('License decrypt request received');

        try {
            // 認証情報からuserIdを取得
            const userId = event.requestContext.authorizer?.claims?.sub;
            if (!userId) {
                return createUnauthorizedResponse('User authentication required');
            }

            // パスパラメータの有無で処理を分岐
            const applicationId = event.pathParameters?.id;
            if (!applicationId) {
                return await handleDirectDecrypt(event, userId);
            } else {
                return await handleApplicationDecrypt(event, userId, applicationId);
            }

        } catch (error) {
            deps.logger.error('Error in main handler', { error });
            return createInternalErrorResponse('Failed to process request', error as Error);
        }
    };
};

// Production設定（必須）
const container = createProductionContainer();
const dependencies: DecryptLicenseHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    masterKeyService: container.resolve('masterKeyService'),
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