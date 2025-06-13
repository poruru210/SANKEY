import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createProductionContainer } from '../../di/container';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { TestGasConnectionHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { UserProfile } from '../../models/userProfile';

// ハンドラーファクトリー（必須）
export const createHandler = (deps: TestGasConnectionHandlerDependencies) => {
    const USER_PROFILE_TABLE_NAME = process.env.USER_PROFILE_TABLE_NAME!;

    // UserProfile取得
    async function getUserProfile(userId: string): Promise<UserProfile | null> {
        try {
            const command = new GetCommand({
                TableName: USER_PROFILE_TABLE_NAME,
                Key: { userId }
            });

            const result = await deps.docClient.send(command);
            return result.Item as UserProfile || null;
        } catch (error) {
            deps.logger.error('Failed to get user profile', { error, userId });
            throw error;
        }
    }

    // UserProfile更新
    async function updateUserProfile(
        userId: string,
        updates: Partial<UserProfile>
    ): Promise<UserProfile> {
        try {
            const timestamp = new Date().toISOString();

            const command = new UpdateCommand({
                TableName: USER_PROFILE_TABLE_NAME,
                Key: { userId },
                UpdateExpression: 'SET setupPhase = :setupPhase, testResults = :testResults, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':setupPhase': updates.setupPhase,
                    ':testResults': updates.testResults,
                    ':updatedAt': timestamp
                },
                ReturnValues: 'ALL_NEW'
            });

            const result = await deps.docClient.send(command);
            return result.Attributes as UserProfile;
        } catch (error) {
            deps.logger.error('Failed to update user profile', { error, userId, updates });
            throw error;
        }
    }

    // UserProfile初期作成
    async function createUserProfile(userId: string): Promise<UserProfile> {
        try {
            const timestamp = new Date().toISOString();
            const profile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                testResults: {},
                notificationEnabled: true,
                createdAt: timestamp,
                updatedAt: timestamp
            };

            const command = new PutCommand({
                TableName: USER_PROFILE_TABLE_NAME,
                Item: profile,
                ConditionExpression: 'attribute_not_exists(userId)'
            });

            await deps.docClient.send(command);
            return profile;
        } catch (error) {
            deps.logger.error('Failed to create user profile', { error, userId });
            throw error;
        }
    }

    // メインハンドラ
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        deps.logger.info('GAS connection test notification received');

        // ヘッダー情報をログ出力
        deps.logger.info('Request headers analysis', {
            headers: event.headers,
            sourceIp: event.requestContext?.identity?.sourceIp,
            userAgent: event.headers['user-agent'] || event.headers['User-Agent'],
            referer: event.headers['referer'] || event.headers['Referer'],
            origin: event.headers['origin'] || event.headers['Origin'],
            host: event.headers['host'] || event.headers['Host']
        });

        try {
            if (!event.body) {
                return createValidationErrorResponse('Request body is required');
            }

            let requestData;
            try {
                requestData = JSON.parse(event.body);
            } catch (error) {
                return createValidationErrorResponse('Invalid JSON in request body');
            }

            const { userId, testResult } = requestData;

            // 基本パラメータ検証
            if (!userId || !testResult) {
                return createValidationErrorResponse('Missing required parameters: userId, testResult');
            }

            if (typeof testResult.success !== 'boolean' || !testResult.timestamp) {
                return createValidationErrorResponse(
                    'Invalid testResult format. Required: success (boolean), timestamp (string)'
                );
            }

            deps.logger.info('Processing GAS test result', {
                userId,
                testSuccess: testResult.success,
                timestamp: testResult.timestamp,
                details: testResult.details
            });

            // JWT認証（JWT_SECRET の存在確認）
            try {
                const isValidUser = await deps.jwtKeyService.validateJwtAccess(userId);
                if (!isValidUser) {
                    return createUnauthorizedResponse('Authentication failed: Invalid user or JWT secret not found');
                }
            } catch (error) {
                deps.logger.error('Authentication failed', {
                    error: error instanceof Error ? error.message : String(error),
                    userId
                });
                return createUnauthorizedResponse('Authentication failed');
            }

            deps.logger.info('Authentication successful', { userId });

            // UserProfile取得（存在しない場合は作成）
            let userProfile = await getUserProfile(userId);
            if (!userProfile) {
                deps.logger.info('User profile not found, creating new profile', { userId });
                userProfile = await createUserProfile(userId);
            }

            // テスト結果が失敗の場合
            if (!testResult.success) {
                const updatedTestResults = {
                    ...userProfile.testResults,
                    setupTest: {
                        success: false,
                        timestamp: testResult.timestamp,
                        details: testResult.details || 'GAS connection test failed'
                    }
                };

                await updateUserProfile(userId, {
                    setupPhase: userProfile.setupPhase, // 現状維持
                    testResults: updatedTestResults
                });

                return createSuccessResponse('GAS connection test failure recorded', {
                    setupPhase: userProfile.setupPhase,
                    testResult: testResult,
                    nextStep: 'Please check GAS configuration and retry the test'
                });
            }

            // テスト成功の場合：setupPhaseを'TEST'に更新
            const updatedTestResults = {
                ...userProfile.testResults,
                setupTest: {
                    success: true,
                    timestamp: testResult.timestamp,
                    details: testResult.details || 'GAS connection test completed successfully'
                }
            };

            await updateUserProfile(userId, {
                setupPhase: 'TEST',
                testResults: updatedTestResults
            });

            deps.logger.info('GAS connection test result recorded successfully', {
                userId,
                previousPhase: userProfile.setupPhase,
                newPhase: 'TEST',
                testSuccess: true,
                gasProjectId: testResult.gasProjectId
            });

            return createSuccessResponse('GAS connection test result recorded successfully', {
                setupPhase: 'TEST',
                testResult: testResult,
                nextStep: 'Ready for integration test'
            });

        } catch (error) {
            deps.logger.error('Error processing GAS connection test', { error });
            return createInternalErrorResponse('Failed to process GAS connection test', error as Error);
        }
    };
};

// Production設定（必須）
const container = createProductionContainer();
const dependencies: TestGasConnectionHandlerDependencies = {
    jwtKeyService: container.resolve('jwtKeyService'),
    docClient: container.resolve('docClient'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// Middleware適用（必須）
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));