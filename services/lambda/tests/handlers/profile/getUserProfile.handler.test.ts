import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/profile/getUserProfile.handler';
import { DIContainer, GetUserProfileHandlerDependencies } from '../../../src/di/dependencies';
import { UserProfile } from '../../../src/models/userProfile';

describe('getUserProfile.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockUserProfileRepository: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: GetUserProfileHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        process.env.USER_PROFILE_TABLE_NAME = 'test-user-profiles';

        // テストコンテナから依存関係を取得
        container = createTestContainer({ useRealServices: false });
        mockUserProfileRepository = container.resolve('userProfileRepository');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            userProfileRepository: mockUserProfileRepository,
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

            mockUserProfileRepository.getUserProfile.mockResolvedValue(existingProfile);

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Profile retrieved successfully');
            expect(responseBody.data).toEqual(existingProfile);

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.getUserProfile).toHaveBeenCalledWith(userId);

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith('User profile retrieved successfully', {
                userId,
                setupPhase: 'PRODUCTION'
            });
        });

        it('プロファイルが存在しない場合はデフォルトプロファイルを作成する', async () => {
            // Arrange
            const userId = 'new-user-456';

            mockUserProfileRepository.getUserProfile.mockResolvedValue(null);
            mockUserProfileRepository.createUserProfile.mockResolvedValue(undefined);

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

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.getUserProfile).toHaveBeenCalledWith(userId);
            expect(mockUserProfileRepository.createUserProfile).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId,
                    setupPhase: 'SETUP',
                    notificationEnabled: true
                })
            );

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith('User profile not found, creating default profile', { userId });
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

            mockUserProfileRepository.getUserProfile
                .mockResolvedValueOnce(null) // 最初の取得
                .mockResolvedValueOnce(existingProfile); // 競合後の再取得

            mockUserProfileRepository.createUserProfile.mockRejectedValue(
                new Error('User profile already exists')
            );

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.data).toEqual(existingProfile);

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.getUserProfile).toHaveBeenCalledTimes(2);
            expect(mockUserProfileRepository.createUserProfile).toHaveBeenCalledTimes(1);

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

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Unauthorized');

            // Repository が呼び出されていないことを確認
            expect(mockUserProfileRepository.getUserProfile).not.toHaveBeenCalled();
        });

        it('DynamoDB GetCommand エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const dbError = new Error('DynamoDB connection failed');

            mockUserProfileRepository.getUserProfile.mockRejectedValue(dbError);

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
                'Error getting user profile',
                { error: 'DynamoDB connection failed' }
            );
        });

        it('DynamoDB PutCommand エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'new-user-456';
            const putError = new Error('Failed to put item');

            mockUserProfileRepository.getUserProfile.mockResolvedValue(null);
            mockUserProfileRepository.createUserProfile.mockRejectedValue(putError);

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
                'Error getting user profile',
                { error: 'Failed to put item' }
            );
        });

        it('環境変数USER_PROFILE_TABLE_NAMEが設定されていない場合でもエラーにならない', async () => {
            // Arrange
            delete process.env.USER_PROFILE_TABLE_NAME;
            const userId = 'test-user-123';
            const profile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(profile);

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data).toEqual(profile);
        });

        it('競合解決時に既存プロファイルも取得できない場合は500を返す', async () => {
            // Arrange
            const userId = 'concurrent-user-error';

            mockUserProfileRepository.getUserProfile
                .mockResolvedValueOnce(null) // 最初の取得
                .mockResolvedValueOnce(null); // 競合後の再取得も失敗

            mockUserProfileRepository.createUserProfile.mockRejectedValue(
                new Error('User profile already exists')
            );

            const event = createTestEvent(userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Failed to get user profile');
            // エラーデータは data フィールドの中にある
            expect(responseBody.data).toBeDefined();
            expect(responseBody.data.error).toContain('Failed to retrieve user profile after creation conflict');
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

            mockUserProfileRepository.getUserProfile.mockResolvedValue(profileWithTests);

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