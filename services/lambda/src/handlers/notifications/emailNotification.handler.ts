import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { Resend } from 'resend';
import middy from '@middy/core';

import { encryptLicense } from '../../services/encryption';
import { createLicensePayloadV1, LicensePayloadV1 } from '../../models/licensePayload';
import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { MasterKeyService } from '../../services/masterKeyService';
import { NotificationMessage } from '../../models/eaApplication';

// Logger設定
const logger = new Logger({
    logLevel: 'DEBUG',
    serviceName: 'email-notification'
});

const tracer = new Tracer({ serviceName: 'email-notification' });

// DI対応: Repository を初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// SSM Client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });

// Master Key Service の初期化
const masterKeyService = new MasterKeyService({
    ssmClient: tracer.captureAWSv3Client(ssmClient),
    logger
});

// Resend API Key取得関数
async function getResendApiKey(): Promise<string> {
    try {
        const parameterName = process.env.RESEND_API_KEY_PARAM;
        if (!parameterName) {
            throw new Error('RESEND_API_KEY_PARAM environment variable is not set');
        }

        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);

        if (!response.Parameter?.Value) {
            throw new Error(`Resend API key not found in Parameter Store at ${parameterName}`);
        }

        return response.Parameter.Value;
    } catch (error) {
        logger.error('Failed to get Resend API key from Parameter Store', {
            error,
            parameterName: process.env.RESEND_API_KEY_PARAM
        });
        throw error;
    }
}

// Resendインスタンスを遅延初期化
let resendInstance: Resend | null = null;

async function getResendInstance(): Promise<Resend> {
    if (!resendInstance) {
        const apiKey = await getResendApiKey();
        resendInstance = new Resend(apiKey);
    }
    return resendInstance;
}

// メール送信処理
async function sendLicenseEmail(
    userEmail: string,
    eaName: string,
    accountNumber: string,
    licenseKey: string
): Promise<void> {
    try {
        const resend = await getResendInstance();

        const emailContent = {
            from: process.env.EMAIL_FROM_ADDRESS || 'noreply@sankey.niraikanai.trade',
            to: userEmail,
            subject: `EA License Approved - ${eaName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2c3e50;">EA License Approved</h2>
                    <p>Your EA license application has been approved!</p>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="color: #495057; margin-top: 0;">License Details</h3>
                        <p><strong>EA Name:</strong> ${eaName}</p>
                        <p><strong>Account Number:</strong> ${accountNumber}</p>
                        <p><strong>Approved At:</strong> ${new Date().toISOString()}</p>
                    </div>
                    
                    <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="color: #1565c0; margin-top: 0;">License Key</h3>
                        <p style="font-family: monospace; background: white; padding: 15px; border-radius: 4px; word-break: break-all; font-size: 12px;">
                            ${licenseKey}
                        </p>
                        <p style="font-size: 14px; color: #666; margin-bottom: 0;">
                            Please copy this license key and configure it in your EA settings.
                        </p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                        <p style="color: #6c757d; font-size: 14px;">
                            This is an automated message. Please do not reply to this email.
                        </p>
                    </div>
                </div>
            `,
        };

        const result = await resend.emails.send(emailContent);

        logger.info('Email sent successfully', {
            emailId: result.data?.id,
            userEmail,
            eaName,
            accountNumber
        });

    } catch (error) {
        logger.error('Failed to send email', {
            error,
            userEmail,
            eaName,
            accountNumber
        });
        throw error;
    }
}

// SQSメッセージ処理
async function processNotificationMessage(record: SQSRecord): Promise<void> {
    try {
        const message: NotificationMessage = JSON.parse(record.body);

        logger.info('Processing notification message', {
            applicationSK: message.applicationSK,
            userId: message.userId
        });

        // 1. アプリケーションの現在の情報を取得
        const application = await repository.getApplication(
            message.userId,
            message.applicationSK
        );

        if (!application) {
            logger.error('Application not found for notification', {
                userId: message.userId,
                applicationSK: message.applicationSK
            });
            return; // メッセージを破棄
        }

        if (application.status !== 'AwaitingNotification') {
            logger.warn('Application is not in AwaitingNotification status', {
                userId: message.userId,
                applicationSK: message.applicationSK,
                currentStatus: application.status
            });
            return; // 既にキャンセルされた可能性
        }

        // 承認時に保存された情報を確認
        if (!application.email || !application.eaName || !application.accountNumber || !application.expiryDate) {
            logger.error('Missing required application data for license generation', {
                userId: message.userId,
                applicationSK: message.applicationSK,
                hasEmail: !!application.email,
                hasEaName: !!application.eaName,
                hasAccountNumber: !!application.accountNumber,
                hasExpiryDate: !!application.expiryDate
            });
            throw new Error('Missing required application data');
        }

        // 2. 共通サービスを使用してマスターキーを取得
        const masterKey = await masterKeyService.getUserMasterKeyForEncryption(message.userId);

        const payload: LicensePayloadV1 = createLicensePayloadV1({
            eaName: application.eaName,
            accountId: application.accountNumber,
            expiry: application.expiryDate,
            userId: message.userId,
            issuedAt: new Date().toISOString(),
        });

        const license = await encryptLicense(masterKey, payload, application.accountNumber);

        logger.info('License generated successfully', {
            userId: message.userId,
            accountId: application.accountNumber,
            eaName: application.eaName,
            expiry: application.expiryDate,
            version: payload.version,
        });

        // 3. メール送信
        await sendLicenseEmail(
            application.email,
            application.eaName,
            application.accountNumber,
            license
        );

        // 4. アプリケーションステータスをActiveに更新し、ライセンス情報を保存
        await repository.activateApplicationWithLicense(
            message.userId,
            message.applicationSK,
            license,
            payload.issuedAt
        );

        logger.info('Notification process completed successfully', {
            userId: message.userId,
            applicationSK: message.applicationSK,
            eaName: application.eaName,
            version: payload.version,
            newStatus: 'Active'
        });

    } catch (error) {
        logger.error('Failed to process notification message', {
            error,
            record: record.body
        });
        throw error; // SQSでリトライ処理
    }
}

// メインハンドラ
const baseHandler = async (event: SQSEvent): Promise<void> => {
    logger.info('Email notification handler started', {
        recordCount: event.Records.length
    });

    const promises = event.Records.map(record => processNotificationMessage(record));

    try {
        await Promise.all(promises);
        logger.info('All notification messages processed successfully');
    } catch (error) {
        logger.error('Some notification messages failed to process', { error });
        throw error; // 部分的な失敗でもSQSにエラーを返す
    }
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger, {
        logEvent: true,
    }))
    .use(captureLambdaHandler(tracer));