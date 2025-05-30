import { SQSEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Resend } from 'resend';
import middy from '@middy/core';

const logger = new Logger({ serviceName: 'email-notification' });
const tracer = new Tracer({ serviceName: 'email-notification' });

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssmClient = new SSMClient({});

let resendClient: Resend;

// Resend API Keyの取得とクライアント初期化
async function getResendClient(): Promise<Resend> {
    if (!resendClient) {
        try {
            const { Parameter } = await ssmClient.send(
                new GetParameterCommand({
                    Name: process.env.RESEND_API_KEY_PARAM!,
                    WithDecryption: true,
                })
            );

            if (!Parameter?.Value) {
                throw new Error('Resend API key not found');
            }

            resendClient = new Resend(Parameter.Value);
            logger.info('Resend client initialized');
        } catch (error) {
            logger.error('Failed to initialize Resend client', { error });
            throw error;
        }
    }
    return resendClient;
}

// DynamoDBからアプリケーション取得
async function getApplication(applicationKey: string, userId: string) {
    try {
        const response = await dynamoClient.send(
            new GetCommand({
                TableName: process.env.TABLE_NAME!,
                Key: {
                    userId,
                    sk: applicationKey,
                },
            })
        );

        return response.Item;
    } catch (error) {
        logger.error('Failed to get application', { error, applicationKey, userId });
        throw error;
    }
}

// アプリケーションステータス更新
async function updateApplicationStatus(
    applicationKey: string,
    userId: string,
    status: string
) {
    try {
        await dynamoClient.send(
            new UpdateCommand({
                TableName: process.env.TABLE_NAME!,
                Key: {
                    userId,
                    sk: applicationKey,
                },
                UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
                ExpressionAttributeNames: {
                    '#status': 'status',
                },
                ExpressionAttributeValues: {
                    ':status': status,
                    ':updatedAt': new Date().toISOString(),
                },
            })
        );

        logger.info('Application status updated', { applicationKey, userId, status });
    } catch (error) {
        logger.error('Failed to update application status', {
            error,
            applicationKey,
            userId,
            status
        });
        throw error;
    }
}

// ライセンス通知メール送信
async function sendLicenseEmail(
    email: string,
    eaName: string,
    licenseKey: string,
    accountNumber: string
): Promise<void> {
    const resend = await getResendClient();

    const emailContent = {
        from: 'license@sankey.niraikanai.trade',
        to: email,
        subject: `ライセンスキー発行完了 - ${eaName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">ライセンスキーが発行されました</h2>
                
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">ライセンス情報</h3>
                    <p><strong>EA名:</strong> ${eaName}</p>
                    <p><strong>口座番号:</strong> ${accountNumber}</p>
                    <p><strong>ライセンスキー:</strong></p>
                    <code style="background-color: white; padding: 10px; display: block; border: 1px solid #ddd; border-radius: 4px; word-break: break-all;">
                        ${licenseKey}
                    </code>
                </div>
                
                <div style="background-color: #e8f4fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="color: #1976d2; margin-top: 0;">使用方法</h4>
                    <ol>
                        <li>MetaTraderでEAを起動してください</li>
                        <li>ライセンスキー入力画面で上記のキーを貼り付けてください</li>
                        <li>「ライセンス認証」ボタンをクリックしてください</li>
                    </ol>
                </div>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0;"><strong>注意事項:</strong></p>
                    <ul style="margin-bottom: 0;">
                        <li>ライセンスキーは大切に保管してください</li>
                        <li>他の人とライセンスキーを共有しないでください</li>
                        <li>問題がある場合はサポートまでお問い合わせください</li>
                    </ul>
                </div>
                
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #666; font-size: 14px;">
                    このメールは自動送信されています。<br>
                    ご質問がある場合は、support@sankey.niraikanai.trade までお問い合わせください。
                </p>
            </div>
        `,
    };

    try {
        const result = await resend.emails.send(emailContent);
        logger.info('License email sent successfully', {
            email,
            eaName,
            accountNumber,
            messageId: result.data?.id
        });
    } catch (error) {
        logger.error('Failed to send license email', {
            error,
            email,
            eaName,
            accountNumber
        });
        throw error;
    }
}

// メインハンドラ
const baseHandler = async (event: SQSEvent): Promise<void> => {
    logger.info('Processing license notification queue', {
        recordCount: event.Records.length
    });

    for (const record of event.Records) {
        try {
            const messageBody = JSON.parse(record.body);
            const { applicationKey, licenseKey, userEmail, eaName, accountNumber, userId } = messageBody;

            logger.info('Processing license notification', {
                applicationKey,
                userEmail,
                eaName,
                accountNumber,
                userId
            });

            // DB状態確認（取り消されていないかチェック）
            const application = await getApplication(applicationKey, userId);

            if (!application) {
                logger.warn('Application not found', { applicationKey, userId });
                continue;
            }

            if (application.status !== 'AwaitingNotification') {
                logger.info('Application status changed, skipping email', {
                    applicationKey,
                    currentStatus: application.status
                });
                continue;
            }

            // メール送信
            await sendLicenseEmail(userEmail, eaName, licenseKey, accountNumber);

            // DB更新（Active状態に）
            await updateApplicationStatus(applicationKey, userId, 'Active');

            logger.info('License notification completed successfully', {
                applicationKey,
                userEmail,
                eaName
            });

        } catch (error) {
            logger.error('Failed to process license notification', {
                error,
                record: record.body
            });
            // SQSの再試行メカニズムに任せる
            throw error;
        }
    }
};

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));