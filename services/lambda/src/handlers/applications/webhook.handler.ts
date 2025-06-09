import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createHmac, timingSafeEqual } from 'crypto';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';

const logger = new Logger();
const tracer = new Tracer();

// DynamoDB Client with enhanced retry configuration
const dynamoDbClient = tracer.captureAWSv3Client(new DynamoDBClient({
    retryMode: 'adaptive',
    maxAttempts: 3,
}));

// SSM Client with standard retry
const ssmClient = tracer.captureAWSv3Client(new SSMClient({
    retryMode: 'adaptive',
    maxAttempts: 3,
}));

const TABLE_NAME = process.env.TABLE_NAME!;
const SSM_USER_PREFIX = process.env.SSM_USER_PREFIX!;

const errorResponse = (statusCode: number, message: string, details?: any) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify({
        status: 'error',
        message,
        ...(details && { details }),
    }),
});

const successResponse = (data: any) => ({
    statusCode: 200,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify({
        status: 'success',
        ...data,
    }),
});

// Base64URL デコード
const base64UrlDecode = (str: string): string => {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return Buffer.from(str, 'base64').toString('utf8');
};

// Base64URL デコード（バイナリ用）
const base64UrlDecodeBuffer = (str: string): Buffer => {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return Buffer.from(str, 'base64');
};

// JWT検証
const verifyJWT = (jwt: string, key: string): any => {
    try {
        const parts = jwt.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid JWT format - expected 3 parts, got ' + parts.length);
        }

        const [headerB64, payloadB64, signatureB64] = parts;

        // ヘッダーとペイロードのデコード
        let header, payload;
        try {
            header = JSON.parse(base64UrlDecode(headerB64));
            payload = JSON.parse(base64UrlDecode(payloadB64));
        } catch (decodeError) {
            const errorMessage = decodeError instanceof Error ? decodeError.message : String(decodeError);
            logger.error('Failed to decode JWT parts', { error: errorMessage });
            throw new Error('Failed to decode JWT parts');
        }

        // アルゴリズム確認
        if (header.alg !== 'HS256') {
            throw new Error(`Unsupported algorithm: ${header.alg}`);
        }

        if (header.typ !== 'JWT') {
            throw new Error(`Unsupported type: ${header.typ}`);
        }

        // 署名検証
        const signatureInput = headerB64 + '.' + payloadB64;
        const keyBuffer = Buffer.from(key, 'base64');
        const expectedSignature = createHmac('sha256', keyBuffer)
            .update(signatureInput)
            .digest();

        const receivedSignature = base64UrlDecodeBuffer(signatureB64);

        if (!timingSafeEqual(expectedSignature, receivedSignature)) {
            logger.error('JWT signature verification failed');
            throw new Error('Invalid signature');
        }

        // 有効期限確認
        const currentTime = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < currentTime) {
            logger.warn('JWT expired', {
                exp: payload.exp,
                currentTime,
                diff: currentTime - payload.exp
            });
            throw new Error('JWT expired');
        }

        // 発行時刻確認（未来の時刻でないこと）
        if (payload.iat && payload.iat > currentTime + 60) { // 1分の余裕
            logger.warn('JWT issued in the future', {
                iat: payload.iat,
                currentTime,
                diff: payload.iat - currentTime
            });
            throw new Error('JWT issued in the future');
        }

        return payload;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('JWT verification failed', {
            error: errorMessage
        });
        throw error;
    }
};

// データの検証（JWT版）
const verifyData = (data: string, iv: string, key: string): string => {
    try {
        // JWT形式かチェック
        if (data.includes('.')) {
            const payload = verifyJWT(data, key);

            if (!payload.data) {
                throw new Error('JWT payload missing data field');
            }

            return JSON.stringify(payload.data);
        }

        // 従来形式（後方互換性）
        throw new Error('Non-JWT format not supported in this version');

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Data verification failed', {
            error: errorMessage
        });
        throw new Error('Failed to verify data: ' + errorMessage);
    }
};

// HMAC検証（JWT版）
const verifyHmac = (data: string, receivedHmac: string, key: string): boolean => {
    try {
        // JWT形式の場合、JWTの署名検証で十分
        if (data.includes('.')) {
            return receivedHmac === 'jwt-signed';
        }

        // 従来のHMAC検証（後方互換性）
        const expectedHmac = createHmac('sha256', Buffer.from(key, 'base64'))
            .update(data, 'base64')
            .digest('hex');

        const receivedBuffer = Buffer.from(receivedHmac, 'hex');
        const expectedBuffer = Buffer.from(expectedHmac, 'hex');

        return receivedBuffer.length === expectedBuffer.length &&
            timingSafeEqual(receivedBuffer, expectedBuffer);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('HMAC verification failed', { error: errorMessage });
        return false;
    }
};

// フォームデータのバリデーション
const validateFormData = (formData: any): string[] => {
    const requiredFields = ['eaName', 'accountNumber', 'broker', 'email', 'xAccount'];
    const errors: string[] = [];

    for (const field of requiredFields) {
        if (!formData[field] || typeof formData[field] !== 'string' || !formData[field].trim()) {
            errors.push(`Missing or invalid field: ${field}`);
        }
    }

    if (formData.email && !formData.email.includes('@')) {
        errors.push('Invalid email format');
    }

    if (formData.xAccount && !formData.xAccount.startsWith('@')) {
        errors.push('X account should start with @');
    }

    return errors;
};

// DynamoDBアイテムの作成
const createApplicationItem = (userId: string, formData: any) => {
    const now = new Date().toISOString();
    const sk = `APPLICATION#${now}#${formData.broker}#${formData.accountNumber}#${formData.eaName}`;

    return {
        TableName: TABLE_NAME,
        Item: {
            userId: { S: userId },
            sk: { S: sk },
            accountNumber: { S: formData.accountNumber.trim() },
            eaName: { S: formData.eaName.trim() },
            broker: { S: formData.broker.trim() },
            email: { S: formData.email.trim() },
            xAccount: { S: formData.xAccount.trim() },
            status: { S: 'Pending' },
            appliedAt: { S: now },
            updatedAt: { S: now },
            source: { S: 'webhook' },
            authMethod: { S: 'JWT' },
        },
    };
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
    logger.info('Webhook request received', {
        httpMethod: event.httpMethod,
        path: event.path
    });

    try {
        if (!event.body) {
            return errorResponse(400, 'Request body is required');
        }

        let requestData;
        try {
            requestData = JSON.parse(event.body);
        } catch (error) {
            return errorResponse(400, 'Invalid JSON in request body');
        }

        const { userId, data, iv, hmac, method } = requestData;
        if (!userId || !data || !hmac) {
            return errorResponse(400, 'Missing required fields: userId, data, hmac');
        }

        logger.info('Processing webhook for user', {
            userId,
            method: method || 'unknown',
            isJWT: data.includes('.')
        });

        // SSMからmaster-keyを取得
        const ssmKey = `${SSM_USER_PREFIX}/${userId}/master-key`;
        let masterKey: string;

        try {
            const ssmResponse = await ssmClient.send(new GetParameterCommand({
                Name: ssmKey,
            }));

            if (!ssmResponse.Parameter?.Value) {
                logger.error('Master key not found in SSM', { ssmKey });
                return errorResponse(401, 'Authentication failed');
            }

            masterKey = ssmResponse.Parameter.Value;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorName = error instanceof Error ? error.name : 'UnknownError';

            logger.error('Failed to retrieve master key', {
                error: errorMessage,
                errorName,
                ssmKey
            });
            return errorResponse(401, 'Authentication failed');
        }

        // HMAC検証
        const isValidHmac = verifyHmac(data, hmac, masterKey);
        if (!isValidHmac) {
            logger.error('HMAC verification failed', { userId });
            return errorResponse(401, 'Authentication failed');
        }

        // データ検証
        let verifiedData;
        try {
            const verifiedString = verifyData(data, iv, masterKey);
            verifiedData = JSON.parse(verifiedString);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to verify or parse data', {
                error: errorMessage
            });
            return errorResponse(400, 'Failed to verify data');
        }

        // タイムスタンプ検証（リプレイアタック防止）
        const { formData, timestamp } = verifiedData;
        if (timestamp) {
            const requestTime = new Date(timestamp).getTime();
            const currentTime = Date.now();
            const timeDiff = Math.abs(currentTime - requestTime);

            if (timeDiff > 5 * 60 * 1000) {
                logger.warn('Request timestamp too old', {
                    timestamp,
                    timeDiff
                });
                return errorResponse(400, 'Request timestamp is too old');
            }
        }

        // フォームデータのバリデーション
        const validationErrors = validateFormData(formData);
        if (validationErrors.length > 0) {
            logger.warn('Form validation failed', { validationErrors });
            return errorResponse(400, 'Validation failed', { errors: validationErrors });
        }

        // DynamoDBにアイテムを作成
        const putItemCommand = createApplicationItem(userId, formData);

        try {
            await dynamoDbClient.send(new PutItemCommand(putItemCommand));

            logger.info('Application created successfully', {
                userId,
                eaName: formData.eaName,
                broker: formData.broker,
                accountNumber: formData.accountNumber,
            });

            return successResponse({
                message: 'Application submitted successfully',
                applicationId: putItemCommand.Item.sk.S,
                status: 'Pending',
            });

        } catch (error: any) {
            logger.error('Failed to create application in DynamoDB', {
                error: error.message || error,
                errorName: error.name,
                errorCode: error.$metadata?.httpStatusCode,
                userId
            });

            if (error.name === 'ProvisionedThroughputExceededException' ||
                error.name === 'ThrottlingException') {
                return errorResponse(503, 'Service temporarily unavailable, please try again later');
            }

            return errorResponse(500, 'Failed to create application');
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Unhandled error in webhook handler', { error: errorMessage });
        return errorResponse(500, 'Internal server error');
    }
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));