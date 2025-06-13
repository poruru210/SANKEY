/**
 * Complete Integration Test Handler
 *
 * Handles the completion of integration tests
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createProductionContainer } from '../../di/container';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { CompleteIntegrationTestHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { UserProfile } from '../../models/userProfile';

// Request interface
interface CompletionRequest {
    userId: string;
    testId: string;
    licenseId: string;
    applicationId: string;
    testResult: {
        success: boolean;
        timestamp: string;
        details?: string;
        error?: string;
    };
}

// ハンドラーファクトリー（必須）
export const createHandler = (deps: CompleteIntegrationTestHandlerDependencies) => {
    const USER_PROFILE_TABLE_NAME = process.env.USER_PROFILE_TABLE_NAME!;

    // Get user profile
    async function getUserProfile(userId: string): Promise<UserProfile | null> {
        const result = await deps.docClient.send(new GetCommand({
            TableName: USER_PROFILE_TABLE_NAME,
            Key: { userId }
        }));
        return result.Item as UserProfile || null;
    }

    // Update user profile for completion
    async function markTestCompleted(
        userId: string,
        testSuccess: boolean
    ): Promise<UserProfile> {
        const timestamp = new Date().toISOString();
        const newPhase = testSuccess ? 'PRODUCTION' : 'TEST';

        const result = await deps.docClient.send(new UpdateCommand({
            TableName: USER_PROFILE_TABLE_NAME,
            Key: { userId },
            UpdateExpression: `
                SET setupPhase = :phase,
                    updatedAt = :timestamp
                ${testSuccess ? ', testResults.setup.success = :true' : ''}
            `,
            ExpressionAttributeValues: {
                ':phase': newPhase,
                ':timestamp': timestamp,
                ...(testSuccess && { ':true': true })
            },
            ReturnValues: 'ALL_NEW'
        }));

        return result.Attributes as UserProfile;
    }

    // Main handler
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        deps.logger.info('Integration test completion request received');

        try {
            // Parse and validate request
            if (!event.body) {
                return createValidationErrorResponse('Request body is required');
            }

            const request: CompletionRequest = JSON.parse(event.body);
            const { userId, testId, licenseId, applicationId, testResult } = request;

            // Validate JWT access
            const isValidUser = await deps.jwtKeyService.validateJwtAccess(userId);
            if (!isValidUser) {
                return createUnauthorizedResponse('Authentication failed');
            }

            // Get user profile
            const userProfile = await getUserProfile(userId);
            if (!userProfile) {
                return createNotFoundResponse('User profile not found');
            }

            // Verify test ID matches
            const activeTestId = userProfile.testResults?.integration?.testId;
            if (activeTestId !== testId) {
                return createValidationErrorResponse('Test ID mismatch');
            }

            // Record completion in integration test service
            await deps.integrationTestService.recordProgress(
                userId,
                'COMPLETED',
                testResult.success,
                { licenseId, applicationSK: applicationId }
            );

            // Update user profile
            const wasInTestPhase = userProfile.setupPhase === 'TEST';
            const updatedProfile = await markTestCompleted(userId, testResult.success);
            const phaseChanged = wasInTestPhase && updatedProfile.setupPhase === 'PRODUCTION';

            // Return success
            return createSuccessResponse('Integration test completed', {
                setupPhase: updatedProfile.setupPhase,
                phaseTransitioned: phaseChanged,
                testSuccess: testResult.success,
                message: phaseChanged
                    ? 'Test completed successfully. System is now in PRODUCTION mode.'
                    : testResult.success
                        ? 'Test completed successfully.'
                        : 'Test completed with errors.'
            });

        } catch (error) {
            deps.logger.error('Error completing integration test', { error });
            return createInternalErrorResponse('Failed to complete test', error as Error);
        }
    };
};

// Production設定（必須）
const container = createProductionContainer();
const dependencies: CompleteIntegrationTestHandlerDependencies = {
    jwtKeyService: container.resolve('jwtKeyService'),
    integrationTestService: container.resolve('integrationTestService'),
    docClient: container.resolve('docClient'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// Middleware適用（必須）
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        methods: 'POST,OPTIONS'
    }))
    .use(injectLambdaContext(dependencies.logger))
    .use(captureLambdaHandler(dependencies.tracer));