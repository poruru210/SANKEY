import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { decryptLicense } from '../../services/encryption';
import { LicensePayloadV1 } from '../../models/licensePayload';
import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { MasterKeyService } from '../../services/masterKeyService';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse,
    createNotFoundResponse
} from '../../utils/apiResponse';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'decrypt-license'
});

const tracer = new Tracer({ serviceName: 'decrypt-license' });

// DI対応: クライアントとRepositoryを初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// Master Key Service の初期化
const masterKeyService = new MasterKeyService({ logger });

// 任意のライセンス文字列を直接復号化
async function handleDirectDecrypt(
    event: APIGatewayProxyEvent,
    userId: string
): Promise<APIGatewayProxyResult> {
    logger.info('Processing direct license decrypt request', { userId });

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
        const masterKey = await masterKeyService.getUserMasterKeyForDecryption(userId);

        // ライセンスを復号化
        let decryptedPayload: LicensePayloadV1;
        try {
            decryptedPayload = await decryptLicense(masterKey, encryptedLicense, accountId);
        } catch (error) {
            logger.error('Failed to decrypt license', {
                error,
                userId,
                accountId
            });
            return createValidationErrorResponse('Failed to decrypt license - invalid license key or data corruption');
        }

        logger.info('License decrypted successfully', {
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
        logger.error('Error in direct decrypt process', { error, userId });
        return createInternalErrorResponse('Failed to decrypt license', error as Error);
    }
}

// 既存のアプリケーションIDベース復号化
async function handleApplicationDecrypt(
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

    logger.info('Processing license decrypt request', {
        userId,
        applicationId: fullApplicationKey
    });

    try {
        // DI対応のRepositoryを使用
        const application = await repository.getApplication(userId, fullApplicationKey);
        if (!application) {
            logger.error('Application not found', { userId, applicationId: fullApplicationKey });
            return createNotFoundResponse('Application not found');
        }

        // 必要なデータの存在確認
        if (!application.accountNumber) {
            logger.error('Account number not found in application', { userId, applicationId: fullApplicationKey });
            return createValidationErrorResponse('Account number not found in application');
        }

        if (!application.licenseKey) {
            logger.error('License key not found in application', { userId, applicationId: fullApplicationKey });
            return createValidationErrorResponse('License key not found in application');
        }

        // アプリケーションステータス確認を削除
        // ステータスに関係なく復号化を実行
        logger.info('Application status check bypassed - allowing decryption for all statuses', {
            userId,
            applicationId: fullApplicationKey,
            currentStatus: application.status
        });

        // 共通サービスを使用してマスターキーを取得
        const masterKey = await masterKeyService.getUserMasterKeyForDecryption(userId);

        // DBに保存されているライセンスキーを復号化
        let decryptedPayload: LicensePayloadV1;
        try {
            decryptedPayload = await decryptLicense(masterKey, application.licenseKey!, application.accountNumber);
        } catch (error) {
            logger.error('Failed to decrypt license', {
                error,
                userId,
                applicationId: fullApplicationKey,
                accountNumber: application.accountNumber
            });
            return createValidationErrorResponse('Failed to decrypt license - invalid license key or data corruption');
        }

        logger.info('License decrypted successfully', {
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
        logger.error('Error decrypting license', { error });
        return createInternalErrorResponse('Failed to decrypt license', error as Error);
    }
}

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('License decrypt request received');

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
        logger.error('Error in main handler', { error });
        return createInternalErrorResponse('Failed to process request', error as Error);
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