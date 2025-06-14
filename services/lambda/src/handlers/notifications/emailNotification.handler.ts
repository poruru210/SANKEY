/**
 * Email Notification Handler
 *
 * Processes license generation and email notifications for approved applications
 */

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Resend } from 'resend';
import middy from '@middy/core';

import { encryptLicense } from '../../services/encryption';
import { createLicensePayloadV1, LicensePayloadV1 } from '../../models/licensePayload';
import { createProductionContainer } from '../../di/container';
import type { EmailNotificationHandlerDependencies } from '../../di/types';
import type { EAApplication, NotificationMessage } from '../../models/eaApplication';
import type { UserProfile } from '../../models/userProfile';
import type { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import type { MasterKeyService } from '../../services/masterKeyService';
import type { IntegrationTestService } from '../../services/integrationTestService';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SSMClient } from '@aws-sdk/client-ssm';

// ========================================
// Configuration
// ========================================

// Environment variables
const USER_PROFILE_TABLE_NAME = process.env.USER_PROFILE_TABLE_NAME;
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@sankey.niraikanai.trade';
const RESEND_API_KEY_PARAM = process.env.RESEND_API_KEY_PARAM;

// ========================================
// Types
// ========================================

interface GasLicenseNotification {
    type: 'LICENSE_ISSUED';
    userId: string;
    licenseId: string;
    applicationId: string;
    eaName: string;
    accountNumber: string;
    issuedAt: string;
    testId?: string;
}

// ========================================
// Handler Factory
// ========================================

export const createHandler = (deps: EmailNotificationHandlerDependencies) => {
    const {
        eaApplicationRepository,
        masterKeyService,
        integrationTestService,
        docClient,
        ssmClient,
        logger,
        tracer
    } = deps;

    // ========================================
    // User Profile Access
    // ========================================

    /**
     * Retrieves user profile from DynamoDB
     */
    async function getUserProfile(userId: string): Promise<UserProfile | null> {
        const USER_PROFILE_TABLE_NAME = process.env.USER_PROFILE_TABLE_NAME;

        if (!USER_PROFILE_TABLE_NAME) {
            logger.debug('USER_PROFILE_TABLE_NAME not configured');
            return null;
        }

        try {
            const command = new GetCommand({
                TableName: USER_PROFILE_TABLE_NAME,
                Key: {
                    PK: `USER#${userId}`,
                    SK: 'PROFILE'
                }
            });

            const result = await docClient.send(command);
            return result.Item as UserProfile || null;
        } catch (error) {
            logger.error('Failed to get user profile', { error, userId });
            return null;
        }
    }

    // ========================================
    // GAS Notification
    // ========================================

    /**
     * Sends license notification to GAS webhook
     */
    async function sendGasNotification(
        webhookUrl: string,
        notification: GasLicenseNotification
    ): Promise<boolean> {
        try {
            logger.info('Sending license notification to GAS', {
                webhookUrl,
                licenseId: notification.licenseId,
                testId: notification.testId
            });

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'SANKEY-License-Notification'
                },
                body: JSON.stringify(notification)
            });

            if (response.ok) {
                const responseData = await response.json();
                logger.info('GAS notification sent successfully', {
                    licenseId: notification.licenseId,
                    responseStatus: response.status
                });
                return true;
            } else {
                const responseText = await response.text();
                logger.error('GAS notification failed', {
                    licenseId: notification.licenseId,
                    status: response.status,
                    response: responseText
                });
                return false;
            }

        } catch (error) {
            logger.error('Error sending GAS notification', {
                error: error instanceof Error ? error.message : String(error),
                licenseId: notification.licenseId
            });
            return false;
        }
    }

    /**
     * Handles GAS notification with integration test progress recording
     */
    async function handleGasNotification(application: EAApplication): Promise<void> {
        try {
            // Check if this is an integration test
            const isTest = integrationTestService.isIntegrationTestApplication(application);
            const testId = application.integrationTestId;

            logger.info('GAS notification check', {
                userId: application.userId,
                applicationId: application.sk,
                isIntegrationTest: isTest,
                testId
            });

            // Get user profile for webhook URL
            const userProfile = await getUserProfile(application.userId);
            if (!userProfile) {
                logger.debug('UserProfile not found', { userId: application.userId });
                return;
            }

            const gasWebappUrl = userProfile.testResults?.integration?.gasWebappUrl;
            if (!gasWebappUrl) {
                logger.debug('GAS webhook URL not configured', { userId: application.userId });
                return;
            }

            // Prepare notification data
            const notification: GasLicenseNotification = {
                type: 'LICENSE_ISSUED',
                userId: application.userId,
                licenseId: application.licenseKey!,
                applicationId: application.sk,
                eaName: application.eaName,
                accountNumber: application.accountNumber,
                issuedAt: application.updatedAt,
                ...(isTest && testId && { testId })
            };

            // Send GAS notification
            const success = await sendGasNotification(gasWebappUrl, notification);

            // Record integration test progress if applicable
            if (isTest && testId) {
                logger.info('Recording LICENSE_ISSUED progress', {
                    userId: application.userId,
                    testId,
                    gasNotificationSuccess: success
                });

                try {
                    await integrationTestService.recordProgress(
                        application.userId,
                        'LICENSE_ISSUED',
                        true,
                        {
                            applicationSK: application.sk,
                            licenseId: application.licenseKey
                        }
                    );

                    logger.info('LICENSE_ISSUED progress recorded', {
                        userId: application.userId,
                        testId,
                        licenseId: application.licenseKey
                    });

                } catch (error) {
                    logger.error('Failed to record LICENSE_ISSUED progress', {
                        error: error instanceof Error ? error.message : String(error),
                        userId: application.userId,
                        testId
                    });
                    // Continue processing - progress recording failure is non-fatal
                }
            }

            logger.info('GAS notification process completed', {
                userId: application.userId,
                applicationId: application.sk,
                success,
                isIntegrationTest: isTest
            });

        } catch (error) {
            logger.error('Error in GAS notification handling', {
                error: error instanceof Error ? error.message : String(error),
                userId: application.userId,
                applicationId: application.sk
            });
            // Continue processing - GAS notification errors are non-fatal
        }
    }

    // ========================================
    // Email Sending
    // ========================================

    let resendInstance: Resend | null = null;

    /**
     * Gets or creates Resend instance
     */
    async function getResendInstance(): Promise<Resend> {
        if (!resendInstance) {
            const RESEND_API_KEY_PARAM = process.env.RESEND_API_KEY_PARAM;

            if (!RESEND_API_KEY_PARAM) {
                throw new Error('RESEND_API_KEY_PARAM environment variable is not set');
            }

            const command = new GetParameterCommand({
                Name: RESEND_API_KEY_PARAM,
                WithDecryption: true
            });

            const response = await ssmClient.send(command);
            if (!response.Parameter?.Value) {
                throw new Error(`Resend API key not found at ${RESEND_API_KEY_PARAM}`);
            }

            resendInstance = new Resend(response.Parameter.Value);
        }
        return resendInstance;
    }

    /**
     * Sends license email to user
     */
    async function sendLicenseEmail(
        userEmail: string,
        eaName: string,
        accountNumber: string,
        licenseKey: string
    ): Promise<void> {
        try {
            const resend = await getResendInstance();
            const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@sankey.niraikanai.trade';

            const emailContent = {
                from: EMAIL_FROM_ADDRESS,
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

    // ========================================
    // License Generation
    // ========================================

    /**
     * Processes a single notification message
     */
    async function processNotificationMessage(record: SQSRecord): Promise<void> {
        try {
            const message: NotificationMessage = JSON.parse(record.body);

            logger.info('Processing notification message', {
                applicationSK: message.applicationSK,
                userId: message.userId
            });

            // Get application details
            const application = await eaApplicationRepository.getApplication(
                message.userId,
                message.applicationSK
            );

            if (!application) {
                logger.error('Application not found', {
                    userId: message.userId,
                    applicationSK: message.applicationSK
                });
                return;
            }

            if (application.status !== 'AwaitingNotification') {
                logger.warn('Application not in AwaitingNotification status', {
                    userId: message.userId,
                    applicationSK: message.applicationSK,
                    currentStatus: application.status
                });
                return;
            }

            // Validate required fields
            if (!application.email || !application.eaName ||
                !application.accountNumber || !application.expiryDate) {
                logger.error('Missing required application data', {
                    userId: message.userId,
                    applicationSK: message.applicationSK
                });
                throw new Error('Missing required application data');
            }

            // Check if this is an integration test
            const isTest = integrationTestService.isIntegrationTestApplication(application);

            logger.info('Starting license generation', {
                userId: message.userId,
                applicationSK: message.applicationSK,
                eaName: application.eaName,
                isIntegrationTest: isTest
            });

            // Get master key
            const masterKey = await masterKeyService.getUserMasterKeyForEncryption(message.userId);

            // Create license payload
            const payload: LicensePayloadV1 = createLicensePayloadV1({
                eaName: application.eaName,
                accountId: application.accountNumber,
                expiry: application.expiryDate,
                userId: message.userId,
                issuedAt: new Date().toISOString(),
            });

            // Generate license
            const license = await encryptLicense(masterKey, payload, application.accountNumber);

            logger.info('License generated successfully', {
                userId: message.userId,
                accountId: application.accountNumber,
                eaName: application.eaName,
                expiry: application.expiryDate,
                isIntegrationTest: isTest
            });

            // Send email (skip for integration tests)
            if (!isTest) {
                await sendLicenseEmail(
                    application.email,
                    application.eaName,
                    application.accountNumber,
                    license
                );
                logger.info('License email sent', {
                    userId: message.userId,
                    eaName: application.eaName
                });
            } else {
                logger.info('Skipping email for integration test', {
                    userId: message.userId,
                    eaName: application.eaName
                });
            }

            // Update application status
            const updatedApplication = await eaApplicationRepository.activateApplicationWithLicense(
                message.userId,
                message.applicationSK,
                license,
                payload.issuedAt
            );

            // Handle GAS notification (includes integration test progress)
            await handleGasNotification(updatedApplication);

            logger.info('Notification process completed', {
                userId: message.userId,
                applicationSK: message.applicationSK,
                eaName: application.eaName,
                newStatus: 'Active',
                isIntegrationTest: isTest,
                emailSent: !isTest
            });

        } catch (error) {
            logger.error('Failed to process notification message', {
                error,
                record: record.body
            });
            throw error; // Let SQS handle retry
        }
    }

    // ========================================
    // Main Handler
    // ========================================

    return async (event: SQSEvent): Promise<void> => {
        logger.info('Email notification handler started', {
            recordCount: event.Records.length
        });

        const promises = event.Records.map(record => processNotificationMessage(record));

        try {
            await Promise.all(promises);
            logger.info('All notification messages processed successfully');
        } catch (error) {
            logger.error('Some notification messages failed', { error });
            throw error; // Let SQS handle partial failures
        }
    };
};

// ========================================
// Production Configuration
// ========================================

const container = createProductionContainer();
const dependencies: EmailNotificationHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    masterKeyService: container.resolve('masterKeyService'),
    integrationTestService: container.resolve('integrationTestService'),
    docClient: container.resolve('docClient'),
    ssmClient: container.resolve('ssmClient'),
    logger: container.resolve('logger') as Logger,
    tracer: container.resolve('tracer') as Tracer
};

const baseHandler = createHandler(dependencies);

// Apply middleware
export const handler = middy(baseHandler)
    .use(injectLambdaContext(dependencies.logger, { logEvent: true }))
    .use(captureLambdaHandler(dependencies.tracer));