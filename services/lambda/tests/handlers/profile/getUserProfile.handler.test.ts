import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/profile/getUserProfile.handler';
import type { GetUserProfileHandlerDependencies } from '../../../src/di/types';
import type { UserProfile } from '../../../src/models/userProfile';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

describe('getUserProfile.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockDocClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: GetUserProfileHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        process.env.USER_PROFILE_TABLE_NAME = 'test-user-profiles';

        // テストコンテナから依存関係を取得
        container = createTestContainer();
        mockDocClient = container.resolve('docClient');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            docClient: mockDocClient,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.USER_PROFILE_TABLE_NAME;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (userId?: string): APIGatewayProxyEvent => ({
        httpMethod: 'GET',
        path: '/profile',
        pathParameters: null,
        body: null,
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        isBase64Encoded: false,
        requestContext: {
            authorizer: userId ? {
                claims: {
                    sub: userId
                }
            } : null
        } as any,
        resource: '',
        stageVariables: null
    });

    describe('正常系テスト', () => {
        it('既存のユーザープロファイルを正常に取得する', async () => {
            // Arrange
            const userId = 'test-user-123';
            const existingProfile: UserProfile = {
                userId,
                setupPhase: 'PRODUCTION',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-15T00:00:00Z',
                testResults: {
                    setup: {
                        success: true,
                        timestamp: '2025-01-01T10:00:00Z'
                    }
                }
            };

            const mockSend = vi.fn().mockResolvedValueOnce({
                Item: existingProfile
            });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Profile retrieved successfully');
            expect(responseBody.data).toEqual(existingProfile);

            // DynamoDB 呼び出しの確認
            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: expect.objectContaining({
                        name: 'GetCommand'
                    })
                })
            );

            const getCommand = mockSend.mock.calls[0][0];
            expect(getCommand.input).toEqual({
                TableName: 'test-user-profiles',
                Key: { userId }
            });

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith('User profile retrieved successfully', {
                userId,
                setupPhase: 'PRODUCTION'
            });
        });

        it('プロファイルが存在しない場合はデフォルトプロファイルを作成する', async () => {
            // Arrange
            const userId = 'new-user-456';

            // GetCommand: プロファイルが存在しない
            // PutCommand: 新規作成成功
            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // GetCommand
                .mockResolvedValueOnce({}); // PutCommand
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.data).toMatchObject({
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: expect.any(String),
                updatedAt: expect.any(String)
            });

            // DynamoDB 呼び出しの確認
            expect(mockSend).toHaveBeenCalledTimes(2);

            // GetCommand の確認
            const getCommand = mockSend.mock.calls[0][0];
            expect(getCommand.constructor.name).toBe('GetCommand');
            expect(getCommand.input.Key).toEqual({ userId });

            // PutCommand の確認
            const putCommand = mockSend.mock.calls[1][0];
            expect(putCommand.constructor.name).toBe('PutCommand');
            expect(putCommand.input.TableName).toBe('test-user-profiles');
            expect(putCommand.input.Item).toMatchObject({
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true
            });
            expect(putCommand.input.ConditionExpression).toBe('attribute_not_exists(userId)');

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith('Default user profile created', { userId });
        });

        it('プロファイル作成時に競合状態が発生した場合は既存のプロファイルを取得する', async () => {
            // Arrange
            const userId = 'concurrent-user-789';
            const existingProfile: UserProfile = {
                userId,
                setupPhase: 'TEST',
                notificationEnabled: false,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // ConditionalCheckFailedException エラーの作成
            const conditionalCheckError = Object.assign(
                new Error('The conditional request failed'),
                { name: 'ConditionalCheckFailedException' }
            );

            // GetCommand: プロファイルが存在しない
            // PutCommand: 競合エラー
            // GetCommand: 既存プロファイルを取得
            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // 最初のGetCommand
                .mockRejectedValueOnce(conditionalCheckError) // PutCommand
                .mockResolvedValueOnce({ Item: existingProfile }); // 2回目のGetCommand
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.data).toEqual(existingProfile);

            // DynamoDB 呼び出しの確認
            expect(mockSend).toHaveBeenCalledTimes(3);

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith(
                'User profile already exists, retrieving existing profile',
                { userId }
            );
        });
    });

    describe('異常系テスト', () => {
        it('認証情報がない場合は401を返す', async () => {
            // Arrange
            const event = createTestEvent(); // userIdなし

            // モック関数を設定（呼ばれないことを確認するため）
            const mockSend = vi.fn();
            (mockDocClient.send as any) = mockSend;

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Unauthorized');

            // DynamoDB が呼び出されていないことを確認
            expect(mockSend).not.toHaveBeenCalled();
        });

        it('DynamoDB GetCommand エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const dbError = new Error('DynamoDB connection failed');

            const mockSend = vi.fn().mockRejectedValueOnce(dbError);
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Failed to get user profile');

            // エラーログの確認
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get user profile',
                { error: 'DynamoDB connection failed', userId }
            );
        });

        it('DynamoDB PutCommand エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'new-user-456';
            const putError = new Error('Failed to put item');

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // GetCommand
                .mockRejectedValueOnce(putError); // PutCommand
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Failed to get user profile');

            // エラーログの確認
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to create default user profile',
                { error: 'Failed to put item', userId }
            );
        });

        it('環境変数USER_PROFILE_TABLE_NAMEが設定されていない場合でもundefinedでエラーにならない', async () => {
            // Arrange
            delete process.env.USER_PROFILE_TABLE_NAME;
            const userId = 'test-user-123';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Item: {
                    userId,
                    setupPhase: 'SETUP',
                    notificationEnabled: true,
                    createdAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T00:00:00Z'
                }
            });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // TableName が undefined で呼び出されることを確認
            const getCommand = mockSend.mock.calls[0][0];
            expect(getCommand.input.TableName).toBeUndefined();
        });

        it('競合解決時に既存プロファイルも取得できない場合は500を返す', async () => {
            // Arrange
            const userId = 'concurrent-user-error';

            const conditionalCheckError = Object.assign(
                new Error('The conditional request failed'),
                { name: 'ConditionalCheckFailedException' }
            );

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // 最初のGetCommand
                .mockRejectedValueOnce(conditionalCheckError) // PutCommand
                .mockResolvedValueOnce({ Item: null }); // 2回目のGetCommand（nullを返す）
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Failed to get user profile');
        });
    });

    describe('統合テストプロファイルのテスト', () => {
        it('統合テスト結果を含むプロファイルを正常に取得する', async () => {
            // Arrange
            const userId = 'integration-test-user';
            const profileWithTests: UserProfile = {
                userId,
                setupPhase: 'TEST',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-15T00:00:00Z',
                testResults: {
                    setup: {
                        success: true,
                        timestamp: '2025-01-01T10:00:00Z',
                        details: 'Setup completed successfully'
                    },
                    integration: {
                        testId: 'test-123',
                        gasWebappUrl: 'https://example.com/webapp',
                        applicationSK: 'APPLICATION#2025-01-01#TestBroker#123456#TestEA',
                        licenseId: 'license-123',
                        currentStep: 'COMPLETED',
                        currentStepStatus: 'success',
                        lastUpdated: '2025-01-01T12:00:00Z',
                        completedSteps: {
                            STARTED: '2025-01-01T11:00:00Z',
                            GAS_WEBHOOK_RECEIVED: '2025-01-01T11:30:00Z',
                            LICENSE_ISSUED: '2025-01-01T11:45:00Z',
                            COMPLETED: '2025-01-01T12:00:00Z'
                        }
                    }
                }
            };

            const mockSend = vi.fn().mockResolvedValueOnce({
                Item: profileWithTests
            });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.testResults).toBeDefined();
            expect(responseBody.data.testResults.integration.currentStep).toBe('COMPLETED');
            expect(responseBody.data.testResults.integration.completedSteps).toHaveProperty('COMPLETED');
        });
    });
});