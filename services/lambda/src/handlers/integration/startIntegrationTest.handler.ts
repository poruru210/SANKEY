/**
 * Start Integration Test Handler
 *
 * Initiates the integration test process for EA License Application
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { StartIntegrationTestHandlerDependencies } from '../../di/dependencies';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// Request interface
interface StartIntegrationTestRequest {
    gasWebappUrl: string;
}

// GAS WebApp call interface
interface GasWebAppResponse {
    success: boolean;
    response?: any;
    error?: string;
}

/**
 * Validates the request body
 */
function validateRequest(body: any): { valid: boolean; error?: string; data?: StartIntegrationTestRequest } {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Request body is required' };
    }

    if (!body.gasWebappUrl || typeof body.gasWebappUrl !== 'string') {
        return { valid: false, error: 'gasWebappUrl is required and must be a string' };
    }

    // Basic URL validation
    try {
        new URL(body.gasWebappUrl);
    } catch {
        return { valid: false, error: 'gasWebappUrl must be a valid URL' };
    }

    return {
        valid: true,
        data: {
            gasWebappUrl: body.gasWebappUrl
        }
    };
}

/**
 * Calls the GAS WebApp to trigger the integration test
 */
async function callGasWebApp(
    gasWebappUrl: string,
    testId: string,
    dependencies: StartIntegrationTestHandlerDependencies
): Promise<GasWebAppResponse> {
    try {
        dependencies.logger.info('Calling GAS WebApp', { gasWebappUrl, testId });

        const requestData = {
            action: 'integration_test',
            testId: testId,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(gasWebappUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });

        const responseText = await response.text();
        dependencies.logger.info('GAS WebApp response received', {
            status: response.status,
            statusText: response.statusText
        });

        if (!response.ok) {
            return {
                success: false,
                error: `GAS WebApp returned ${response.status}: ${responseText}`
            };
        }

        try {
            const responseData = JSON.parse(responseText);
            return {
                success: responseData.success !== false,
                response: responseData,
                error: responseData.error
            };
        } catch {
            return {
                success: false,
                error: `Invalid JSON response: ${responseText}`
            };
        }

    } catch (error) {
        dependencies.logger.error('GAS WebApp call failed', { error });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

export const createHandler = (dependencies: StartIntegrationTestHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    dependencies.logger.info('Integration test start request received');

    try {
        // Extract user ID from Cognito claims
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User ID not found in authorization context');
        }

        // Parse and validate request body
        let requestBody: any;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch {
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        const validation = validateRequest(requestBody);
        if (!validation.valid || !validation.data) {
            return createValidationErrorResponse(validation.error || 'Invalid request');
        }

        const { gasWebappUrl } = validation.data;

        dependencies.logger.info('Starting integration test', { userId, gasWebappUrl });

        // Check current test status
        let currentStatus;
        try {
            currentStatus = await dependencies.integrationTestService.getIntegrationTestStatus(userId);
        } catch (error) {
            dependencies.logger.error('Failed to get integration test status', { userId, error });
            currentStatus = {
                active: false,
                canRetry: true,
                progress: 0
            };
        }

        if (!currentStatus) {
            dependencies.logger.warn('Integration test status is null/undefined, treating as no active test', { userId });
            currentStatus = {
                active: false,
                canRetry: true,
                progress: 0
            };
        }

        if (currentStatus.active && !currentStatus.canRetry) {
            return createValidationErrorResponse(
                'An integration test is already in progress',
                {
                    currentStep: currentStatus.test?.currentStep,
                    status: currentStatus.test?.currentStepStatus
                }
            );
        }

        // Clean up any existing test data
        if (currentStatus.test) {
            dependencies.logger.info('Cleaning up previous test data', { userId });
            await dependencies.integrationTestService.cleanupIntegrationTestData(userId);
        }

        // Generate test ID
        const testId = `INTEGRATION_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        dependencies.logger.info('Generated test ID', { testId });

        // Start the integration test
        await dependencies.integrationTestService.startIntegrationTest(userId, testId, gasWebappUrl);

        // Call GAS WebApp
        const gasResult = await callGasWebApp(gasWebappUrl, testId, dependencies);

        if (gasResult.success) {
            // Mark STARTED step as successful
            await dependencies.integrationTestService.recordTestStarted(userId, testId);

            dependencies.logger.info('Integration test started successfully', {
                userId,
                testId,
                gasResponse: gasResult.response
            });

            return createSuccessResponse('Integration test started successfully', {
                testId,
                gasWebappUrl,
                gasResponse: gasResult.response,
                nextStep: 'GAS_WEBHOOK_RECEIVED',
                message: 'Waiting for GAS webhook to proceed'
            });
        } else {
            // Record failure but keep the test active for retry
            await dependencies.integrationTestService.recordProgress(userId, 'STARTED', false, {
                error: gasResult.error || 'Failed to call GAS WebApp'
            });

            dependencies.logger.error('Failed to trigger GAS integration test', {
                userId,
                testId,
                error: gasResult.error
            });

            return createInternalErrorResponse(
                'Failed to trigger integration test',
                new Error(gasResult.error || 'GAS WebApp call failed')
            );
        }

    } catch (error) {
        dependencies.logger.error('Unexpected error in integration test handler', { error });
        return createInternalErrorResponse(
            'An unexpected error occurred',
            error as Error
        );
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: StartIntegrationTestHandlerDependencies = {
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