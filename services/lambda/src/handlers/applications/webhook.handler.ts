/**
 * Webhook Handler
 *
 * Processes incoming webhooks from GAS for EA license applications
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { WebhookHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { EAApplication, ApplicationInput } from '../../models/eaApplication';

// ========================================
// Types
// ========================================

interface WebhookRequest {
    userId: string;
    data: string; // JWT token
    method?: string;
}

// ========================================
// Validation
// ========================================

/**
 * Validates the webhook request body
 */
function validateWebhookRequest(body: any): {
    valid: boolean;
    error?: string;
    data?: WebhookRequest
} {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Request body is required' };
    }

    if (!body.userId || typeof body.userId !== 'string') {
        return { valid: false, error: 'userId is required' };
    }

    if (!body.data || typeof body.data !== 'string') {
        return { valid: false, error: 'data (JWT token) is required' };
    }

    return {
        valid: true,
        data: {
            userId: body.userId,
            data: body.data,
            method: body.method || 'JWT'
        }
    };
}

/**
 * Validates application data from JWT payload
 */
function validateApplicationData(data: any): {
    valid: boolean;
    error?: string;
    applicationData?: ApplicationInput;
} {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Invalid application data' };
    }

    const requiredFields = ['eaName', 'broker', 'accountNumber', 'email'];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
        return {
            valid: false,
            error: `Missing required fields: ${missingFields.join(', ')}`
        };
    }

    return {
        valid: true,
        applicationData: {
            eaName: data.eaName,
            broker: data.broker,
            accountNumber: data.accountNumber,
            email: data.email,
            xAccount: data.xAccount || '',
            integrationTestId: data.integrationTestId
        }
    };
}

// ========================================
// JWT Processing
// ========================================

/**
 * Processes JWT token and extracts application data
 */
async function processJWT(
    userId: string,
    jwtToken: string,
    dependencies: WebhookHandlerDependencies
): Promise<{ success: boolean; error?: string; data?: ApplicationInput }> {
    try {
        // Get JWT secret
        const jwtSecret = await dependencies.jwtKeyService.getJwtSecret(userId);
        dependencies.logger.debug('JWT secret retrieved', { userId });

        // Verify JWT
        const decoded = await dependencies.jwtKeyService.verifyJWT(jwtToken, jwtSecret);
        dependencies.logger.info('JWT verification successful', { userId });

        // Extract application data
        const applicationData = decoded.data.formData || decoded.data;

        // Validate application data
        const validation = validateApplicationData(applicationData);
        if (!validation.valid || !validation.applicationData) {
            return { success: false, error: validation.error };
        }

        return { success: true, data: validation.applicationData };

    } catch (error) {
        dependencies.logger.error('JWT processing failed', {
            error: error instanceof Error ? error.message : String(error),
            userId
        });

        if (error instanceof Error && error.message.includes('JWT secret not found')) {
            return { success: false, error: 'Authentication failed: JWT secret not found' };
        }

        return { success: false, error: 'Authentication failed: Invalid JWT token' };
    }
}

// ========================================
// Integration Test Processing
// ========================================

/**
 * Records integration test progress if applicable
 */
async function recordIntegrationTestProgress(
    application: EAApplication,
    dependencies: WebhookHandlerDependencies
): Promise<void> {
    const isTest = dependencies.integrationTestService.isIntegrationTestApplication(application);

    if (!isTest || !application.integrationTestId) {
        return;
    }

    const testId = application.integrationTestId;

    try {
        await dependencies.integrationTestService.recordProgress(
            application.userId,
            'GAS_WEBHOOK_RECEIVED',
            true,
            {
                applicationSK: application.sk
            }
        );

        dependencies.logger.info('Integration test progress recorded: GAS_WEBHOOK_RECEIVED', {
            userId: application.userId,
            testId,
            applicationId: application.sk
        });

    } catch (error) {
        dependencies.logger.error('Failed to record integration test progress', {
            error: error instanceof Error ? error.message : String(error),
            userId: application.userId,
            testId
        });
        // Re-throw as this is a critical error for integration tests
        throw error;
    }
}

// ========================================
// Main Handler
// ========================================

export const createHandler = (dependencies: WebhookHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    try {
        dependencies.logger.info('Webhook request received', {
            httpMethod: event.httpMethod,
            path: event.path
        });

        // Parse request body
        let requestBody: any;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch (error) {
            dependencies.logger.error('Invalid JSON in request body', { error });
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        // Validate request
        const validation = validateWebhookRequest(requestBody);
        if (!validation.valid || !validation.data) {
            return createValidationErrorResponse(validation.error || 'Invalid request');
        }

        const { userId, data: jwtToken } = validation.data;

        dependencies.logger.info('Processing webhook for user', {
            userId,
            method: validation.data.method
        });

        // Process JWT and extract application data
        const jwtResult = await processJWT(userId, jwtToken, dependencies);
        if (!jwtResult.success || !jwtResult.data) {
            return createUnauthorizedResponse(jwtResult.error || 'Authentication failed');
        }

        const applicationData = jwtResult.data;
        const timestamp = new Date().toISOString();

        // Create application
        const applicationToSave: Omit<EAApplication, 'sk' | 'status' | 'updatedAt'> = {
            userId,
            eaName: applicationData.eaName,
            accountNumber: applicationData.accountNumber,
            broker: applicationData.broker,
            email: applicationData.email,
            xAccount: applicationData.xAccount,
            appliedAt: timestamp,
            ...(applicationData.integrationTestId && {
                integrationTestId: applicationData.integrationTestId
            })
        };

        // Save to DynamoDB
        const savedApplication = await dependencies.eaApplicationRepository.createApplication(applicationToSave);

        dependencies.logger.info('Application saved successfully', {
            userId,
            applicationId: savedApplication.sk,
            eaName: savedApplication.eaName
        });

        // Record integration test progress if applicable
        await recordIntegrationTestProgress(savedApplication, dependencies);

        // Check if this is an integration test
        const isIntegrationTest = dependencies.integrationTestService.isIntegrationTestApplication(savedApplication);

        dependencies.logger.info('Application webhook processed successfully', {
            userId,
            applicationId: savedApplication.sk,
            isIntegrationTest
        });

        // Return success response
        return createSuccessResponse('Application submitted successfully', {
            applicationId: savedApplication.sk,
            status: savedApplication.status,
            temporaryUrl: `https://temp-url-placeholder/${savedApplication.sk}`,
            ...(isIntegrationTest && savedApplication.integrationTestId && {
                testId: savedApplication.integrationTestId,
                integrationType: 'test'
            })
        });

    } catch (error) {
        dependencies.logger.error('Webhook processing failed', {
            error: error instanceof Error ? error.message : String(error)
        });
        return createInternalErrorResponse('Failed to process webhook', error as Error);
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: WebhookHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    jwtKeyService: container.resolve('jwtKeyService'),
    integrationTestService: container.resolve('integrationTestService'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// Apply middleware
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));