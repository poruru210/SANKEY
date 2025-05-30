import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { webcrypto } from 'crypto';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { encryptLicense } from '../services/encryption';
import { LicensePayload } from '../models/licensePayload';

// Logger設定（デバッグレベル有効化）
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'license-generator'
});

const tracer = new Tracer({ serviceName: 'license-generator' });

const ssmClient = new SSMClient({});
const sqsClient = new SQSClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// フロントエンドから受け取る完全な情報
interface ApprovalRequest {
    eaName: string;
    accountId: string;
    expiry: string;
    // 追加情報
    applicationKey: string;  // SKとして使用
    email: string;          // メール送信用
}

// アプリケーション情報の取得（実際はリクエストボディから）
function getApplicationInfo(requestBody: ApprovalRequest, userId: string) {
    return {
        userId,
        sk: requestBody.applicationKey,
        eaName: requestBody.eaName,
        accountNumber: requestBody.accountId,
        email: requestBody.email,
        status: 'Pending'
    };
}

// DynamoDBのアプリケーションステータス更新
async function updateApplicationInDB(
    userId: string,
    sk: string,
    licenseKey: string,
    status: 'AwaitingNotification' | 'Active' = 'AwaitingNotification'
) {
    try {
        const updateParams = {
            TableName: process.env.TABLE_NAME!,
            Key: {
                userId,
                sk
            },
            UpdateExpression: 'SET #status = :status, licenseKey = :licenseKey, approvedAt = :approvedAt, updatedAt = :updatedAt, notificationScheduledAt = :notificationScheduledAt',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':licenseKey': licenseKey,
                ':approvedAt': new Date().toISOString(),
                ':updatedAt': new Date().toISOString(),
                ':notificationScheduledAt': new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5分後
            }
        };

        await dynamoClient.send(new UpdateCommand(updateParams));

        logger.info('Application updated in DB successfully', {
            userId,
            sk,
            status,
            hasLicenseKey: !!licenseKey
        });
    } catch (error) {
        logger.error('Failed to update application in DB', { error, userId, sk });
        throw error;
    }
}

// SQSに通知メッセージ送信
async function sendNotificationToQueue(
    applicationKey: string,
    licenseKey: string,
    userEmail: string,
    eaName: string,
    accountNumber: string,
    userId: string
) {
    try {
        const messageBody = {
            applicationKey,
            licenseKey,
            userEmail,
            eaName,
            accountNumber,
            userId,
            scheduledAt: new Date().toISOString()
        };

        const sendParams = {
            QueueUrl: process.env.NOTIFICATION_QUEUE_URL!,
            MessageBody: JSON.stringify(messageBody),
            DelaySeconds: 300 // 5分遅延
        };

        const result = await sqsClient.send(new SendMessageCommand(sendParams));

        logger.info('Notification message sent to queue successfully', {
            messageId: result.MessageId,
            applicationKey,
            userEmail,
            eaName
        });

        return result;
    } catch (error) {
        logger.error('Failed to send notification to queue', {
            error,
            applicationKey,
            userEmail,
            eaName
        });
        throw error;
    }
}

// ベースハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    logger.info('Received license request');

    // イベント全体をDEBUGレベルでログ出力
    logger.debug('Full event details', { event });

    try {
        let userId: string;
        let requestBody: any;

        // デバッグ用ログ追加
        logger.info('Event details', {
            body: event.body,
            bodyType: typeof event.body,
            headers: event.headers,
            requestContext: {
                requestId: event.requestContext.requestId,
                authorizer: event.requestContext.authorizer
            }
        });

        if (event.body && typeof event.body === 'string') {
            try {
                const parsedBody = JSON.parse(event.body);
                logger.info('Parsed body', { parsedBody });

                if (parsedBody.userId && parsedBody.accountId && parsedBody.body) {
                    logger.info('Using nested body structure');
                    userId = parsedBody.userId;
                    requestBody = JSON.parse(parsedBody.body);
                    // accountIdはrequestBodyから後で取得
                } else {
                    logger.info('Using flat body structure');
                    requestBody = parsedBody;
                    userId = event.requestContext.authorizer?.claims?.sub || '';
                }

                logger.info('Final values', {
                    userId,
                    requestBody,
                    authorizerClaims: event.requestContext.authorizer?.claims
                });

            } catch (e) {
                logger.error('Failed to parse request body', { error: e, body: event.body });
                throw new Error('Invalid request format');
            }
        } else {
            logger.error('No request body provided', { body: event.body });
            throw new Error('No request body provided');
        }

        const { eaName, expiry, accountId, applicationKey, email } = requestBody;

        logger.info('Extracted parameters', {
            eaName,
            expiry,
            userId,
            accountId,
            applicationKey,
            email
        });

        if (!eaName || !expiry || !userId || !accountId || !applicationKey || !email) {
            logger.error('Missing required parameters', {
                eaName: !!eaName,
                expiry: !!expiry,
                userId: !!userId,
                accountId: !!accountId,
                applicationKey: !!applicationKey,
                email: !!email,
                requestBody
            });

            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Missing required parameters',
                    message: 'eaName, expiry, userId, accountId, applicationKey, and email are required',
                    debug: {
                        hasEaName: !!eaName,
                        hasExpiry: !!expiry,
                        hasUserId: !!userId,
                        hasAccountId: !!accountId,
                        hasApplicationKey: !!applicationKey,
                        hasEmail: !!email
                    }
                }),
            };
        }

        const expiryDate = new Date(expiry);
        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid expiry date',
                    message: 'Expiry date must be a valid future date',
                }),
            };
        }

        // 1. アプリケーション情報を取得（リクエストボディから）
        const applicationInfo = getApplicationInfo(requestBody, userId);

        // 2. ライセンス生成
        const masterKey = await getUserMasterKey(userId);

        const payload: LicensePayload = {
            eaName,
            accountId,
            expiry: expiryDate.toISOString(),
            userId,
            issuedAt: new Date().toISOString(),
        };

        const license = await encryptLicense(masterKey, JSON.stringify(payload), accountId);

        logger.info('License generated successfully', {
            userId,
            accountId,
            eaName,
            expiry,
        });

        // 3. データベースのステータス更新（AwaitingNotification状態に）
        await updateApplicationInDB(
            userId,
            applicationInfo.sk,
            license,
            'AwaitingNotification'
        );

        // 4. SQSに通知メッセージ送信（5分遅延）
        await sendNotificationToQueue(
            applicationInfo.sk,
            license,
            email,
            eaName,
            accountId,
            userId
        );

        logger.info('License approval process completed successfully', {
            userId,
            accountId,
            eaName,
            status: 'AwaitingNotification',
            notificationScheduled: true
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                license,
                issuedAt: payload.issuedAt,
                expiresAt: payload.expiry,
                status: 'AwaitingNotification',
                message: 'License generated successfully. Email notification will be sent in 5 minutes.',
                notificationScheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
            }),
        };
    } catch (error) {
        logger.error('Error generating license', { error });

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: 'Failed to generate license',
            }),
        };
    }
};

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

// middy + Powertools middleware 適用（シンプル版）
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers:
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(logger, {
        logEvent: true,
        clearState: true
    }))
    .use(captureLambdaHandler(tracer));