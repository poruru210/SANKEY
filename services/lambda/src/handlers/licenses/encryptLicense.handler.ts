import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { webcrypto } from 'crypto';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { encryptLicense } from '../../services/encryption';
import { createLicensePayloadV1, LicensePayloadV1, PAYLOAD_VERSIONS } from '../../models/licensePayload';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'encrypt-license'
});

const tracer = new Tracer({ serviceName: 'encrypt-license' });
const ssmClient = new SSMClient({});

// リクエストボディの型定義
interface EncryptLicenseRequest {
    userId: string;
    eaName: string;
    accountId: string;
    expiry: string; // ISO date string
    issuedAt?: string; // ISO date string (optional, defaults to now)
    version?: string; // payload version (optional, defaults to 1.0)
}

// Master Key の取得関数
async function getUserMasterKey(userId: string): Promise<CryptoKey> {
    const paramName = `${process.env.SSM_PREFIX}/${userId}/master-key`;

    try {
        const { Parameter } = await ssmClient.send(
            new GetParameterCommand({
                Name: paramName,
                WithDecryption: true,
            })
        );

        if (!Parameter?.Value) {
            logger.error('Master key parameter not found', { userId, paramName });
            throw new Error('Master key not found');
        }

        const keyBuffer = Buffer.from(Parameter.Value, 'base64');
        return await webcrypto.subtle.importKey('raw', keyBuffer, 'AES-CBC', true, ['encrypt']);
    } catch (error) {
        logger.error('Failed to retrieve master key', { userId, error });
        throw new Error('Failed to retrieve encryption key');
    }
}

// リクエストボディのバリデーション後の型定義
interface ValidatedRequest {
    eaName: string;
    accountId: string;
    expiry: string;
    issuedAt: string;
    version: string;
}

// リクエストボディのバリデーション
function validateRequest(body: any): ValidatedRequest {
    if (!body) {
        throw new Error('Request body is required');
    }

    const { eaName, accountId, expiry, issuedAt, version } = body;

    // 必須フィールドの検証
    if (!eaName || typeof eaName !== 'string') {
        throw new Error('eaName is required and must be a string');
    }

    if (!accountId || typeof accountId !== 'string') {
        throw new Error('accountId is required and must be a string');
    }

    if (!expiry || typeof expiry !== 'string') {
        throw new Error('expiry is required and must be an ISO date string');
    }

    // 日付フォーマットの検証
    const expiryDate = new Date(expiry);
    if (isNaN(expiryDate.getTime())) {
        throw new Error('expiry must be a valid ISO date string');
    }

    // 有効期限が過去でないことを確認
    if (expiryDate <= new Date()) {
        throw new Error('expiry must be in the future');
    }

    // オプションフィールドの検証
    let validatedIssuedAt = issuedAt;
    if (issuedAt) {
        const issuedDate = new Date(issuedAt);
        if (isNaN(issuedDate.getTime())) {
            throw new Error('issuedAt must be a valid ISO date string');
        }
    } else {
        validatedIssuedAt = new Date().toISOString();
    }

    // バージョンの検証
    const validatedVersion = version || PAYLOAD_VERSIONS.V1;
    if (validatedVersion !== PAYLOAD_VERSIONS.V1) {
        throw new Error(`Unsupported payload version: ${validatedVersion}. Supported versions: ${PAYLOAD_VERSIONS.V1}`);
    }

    return {
        eaName,
        accountId,
        expiry,
        issuedAt: validatedIssuedAt,
        version: validatedVersion
    };
}

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('License encrypt request received');

    try {
        // 認証情報からuserIdを取得（decryptLicense.handlerと同様）
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User authentication required');
        }

        // この時点でuserIdは確実に文字列
        const authenticatedUserId: string = userId;

        // リクエストボディの解析
        if (!event.body) {
            return createValidationErrorResponse('Request body is required');
        }

        let requestBody: any;
        try {
            requestBody = JSON.parse(event.body);
        } catch (error) {
            return createValidationErrorResponse('Invalid JSON format in request body');
        }

        // リクエストの検証
        let validatedRequest: ValidatedRequest;
        try {
            validatedRequest = validateRequest(requestBody);
        } catch (error) {
            return createValidationErrorResponse((error as Error).message);
        }

        logger.info('Processing license encrypt request', {
            userId: authenticatedUserId,
            eaName: validatedRequest.eaName,
            accountId: validatedRequest.accountId,
            expiry: validatedRequest.expiry,
            version: validatedRequest.version
        });

        // マスターキーを取得
        const masterKey = await getUserMasterKey(authenticatedUserId);

        // ペイロードを作成
        const payload: LicensePayloadV1 = createLicensePayloadV1({
            eaName: validatedRequest.eaName,
            accountId: validatedRequest.accountId,
            expiry: validatedRequest.expiry,
            userId: authenticatedUserId, // 型安全なuserIdを使用
            issuedAt: validatedRequest.issuedAt,
        });

        // ライセンスを暗号化
        const encryptedLicense = await encryptLicense(masterKey, payload, validatedRequest.accountId);

        logger.info('License encrypted successfully', {
            userId: authenticatedUserId,
            eaName: validatedRequest.eaName,
            accountId: validatedRequest.accountId,
            version: payload.version,
            licenseLength: encryptedLicense.length
        });

        // 暗号化されたライセンスを返却
        return createSuccessResponse('License encrypted successfully', {
            encryptedLicense,
            payload: {
                version: payload.version,
                eaName: payload.eaName,
                accountId: payload.accountId,
                expiry: payload.expiry,
                userId: payload.userId,
                issuedAt: payload.issuedAt
            }
        });

    } catch (error) {
        logger.error('Error encrypting license', { error });
        return createInternalErrorResponse('Failed to encrypt license', error as Error);
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