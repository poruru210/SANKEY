import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/profile/updateUserProfile.handler';
import { DIContainer, UpdateUserProfileHandlerDependencies } from '../../../src/di/dependencies';
import { UserProfile } from '../../../src/models/userProfile';

describe('updateUserProfile.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockUserProfileRepository: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: UpdateUserProfileHandlerDependencies;

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
    const createTestEvent = (userId: string | undefined, requestBody: any): APIGatewayProxyEvent => ({
        httpMethod: 'PUT',
        path: '/profile',
        pathParameters: null,
        body: requestBody ? JSON.stringify(requestBody) : null,
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
        it('setupPhaseを正常に更新する（SETUP → TEST）', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedProfile: UserProfile = {
                ...currentProfile,
                setupPhase: 'TEST',
                updatedAt: '2025-01-15T00:00:00Z'
            };

            const requestBody = {
                setupPhase: 'TEST'
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
            mockUserProfileRepository.updateUserProfile.mockResolvedValue(updatedProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Profile updated successfully');
            expect(responseBody.data.setupPhase).toBe('TEST');

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.getUserProfile).toHaveBeenCalledWith(userId);
            expect(mockUserProfileRepository.updateUserProfile).toHaveBeenCalledWith(
                userId,
                requestBody
            );

            // ログの確認
            expect(mockLogger.info).toHaveBeenCalledWith('User profile updated successfully', {
                userId,
                updatedFields: ['setupPhase'],
                setupPhase: 'TEST'
            });
        });

        it('notificationEnabledを正常に更新する', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'PRODUCTION',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedProfile: UserProfile = {
                ...currentProfile,
                notificationEnabled: false,
                updatedAt: '2025-01-15T00:00:00Z'
            };

            const requestBody = {
                notificationEnabled: false
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
            mockUserProfileRepository.updateUserProfile.mockResolvedValue(updatedProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.notificationEnabled).toBe(false);

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.updateUserProfile).toHaveBeenCalledWith(
                userId,
                requestBody
            );
        });

        it('複数のフィールドを同時に更新する', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'TEST',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedProfile: UserProfile = {
                ...currentProfile,
                setupPhase: 'PRODUCTION',
                notificationEnabled: false,
                updatedAt: '2025-01-15T00:00:00Z'
            };

            const requestBody = {
                setupPhase: 'PRODUCTION',
                notificationEnabled: false
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
            mockUserProfileRepository.updateUserProfile.mockResolvedValue(updatedProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.setupPhase).toBe('PRODUCTION');
            expect(responseBody.data.notificationEnabled).toBe(false);

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.updateUserProfile).toHaveBeenCalledWith(
                userId,
                requestBody
            );
        });
    });

    describe('異常系テスト', () => {
        it('認証情報がない場合は401を返す', async () => {
            // Arrange
            const requestBody = { setupPhase: 'TEST' };
            const event = createTestEvent(undefined, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Unauthorized');

            // Repository が呼び出されていないことを確認
            expect(mockUserProfileRepository.getUserProfile).not.toHaveBeenCalled();
            expect(mockUserProfileRepository.updateUserProfile).not.toHaveBeenCalled();
        });

        it('リクエストボディがない場合は400を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const event = createTestEvent(userId, null);
            event.body = null;

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Request body is required');
        });

        it('無効なJSONの場合は400を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const event = createTestEvent(userId, {});
            event.body = 'invalid json';

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Invalid JSON in request body');
        });

        it('ユーザープロファイルが存在しない場合は404を返す', async () => {
            // Arrange
            const userId = 'non-existent-user';
            const requestBody = { setupPhase: 'TEST' };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(null);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(404);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('User profile not found');
        });

        it('無効なsetupPhaseの場合は400を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const requestBody = {
                setupPhase: 'INVALID_PHASE'
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Validation failed');
            expect(responseBody.data.errors).toContain('setupPhase must be one of: SETUP, TEST, PRODUCTION');
        });

        it('許可されないsetupPhase遷移の場合は400を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const requestBody = {
                setupPhase: 'PRODUCTION' // SETUP → PRODUCTION は許可されない
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.errors).toContain(
                'Cannot progress from SETUP to PRODUCTION. Must follow order: SETUP -> TEST -> PRODUCTION'
            );
        });

        it('notificationEnabledが不正な型の場合は400を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const requestBody = {
                notificationEnabled: 'true' // 文字列は無効
            };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.errors).toContain('notificationEnabled must be a boolean');
        });

        it('Repository getUserProfile エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const requestBody = { setupPhase: 'TEST' };

            mockUserProfileRepository.getUserProfile.mockRejectedValue(new Error('DynamoDB error'));

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Failed to update user profile');
        });

        it('Repository updateUserProfile エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const requestBody = { setupPhase: 'TEST' };

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
            mockUserProfileRepository.updateUserProfile.mockRejectedValue(new Error('Update failed'));

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Failed to update user profile');
        });
    });

    describe('setupPhase遷移ルールのテスト', () => {
        const testCases = [
            { from: 'SETUP', to: 'TEST', allowed: true },
            { from: 'TEST', to: 'PRODUCTION', allowed: true },
            { from: 'SETUP', to: 'PRODUCTION', allowed: false },
            { from: 'TEST', to: 'SETUP', allowed: false },
            { from: 'PRODUCTION', to: 'SETUP', allowed: false },
            { from: 'PRODUCTION', to: 'TEST', allowed: false }
        ];

        testCases.forEach(({ from, to, allowed }) => {
            it(`${from} → ${to} 遷移は${allowed ? '許可される' : '許可されない'}`, async () => {
                // Arrange
                const userId = 'test-user-123';
                const currentProfile: UserProfile = {
                    userId,
                    setupPhase: from as any,
                    notificationEnabled: true,
                    createdAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T00:00:00Z'
                };

                const updatedProfile: UserProfile = {
                    ...currentProfile,
                    setupPhase: to as any,
                    updatedAt: '2025-01-15T00:00:00Z'
                };

                const requestBody = { setupPhase: to };

                mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
                if (allowed) {
                    mockUserProfileRepository.updateUserProfile.mockResolvedValue(updatedProfile);
                }

                const event = createTestEvent(userId, requestBody);

                // Act
                const result = await handler(event);

                // Assert
                if (allowed) {
                    expect(result.statusCode).toBe(200);
                    const responseBody = JSON.parse(result.body);
                    expect(responseBody.data.setupPhase).toBe(to);
                } else {
                    expect(result.statusCode).toBe(400);
                    const responseBody = JSON.parse(result.body);
                    expect(responseBody.data.errors[0]).toContain(`Cannot progress from ${from} to ${to}`);
                }
            });
        });
    });

    describe('エッジケースのテスト', () => {
        it('空のリクエストボディの場合も正常に処理される', async () => {
            // Arrange
            const userId = 'test-user-123';
            const currentProfile: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedProfile: UserProfile = {
                ...currentProfile,
                updatedAt: '2025-01-15T00:00:00Z'
            };

            const requestBody = {}; // 空のオブジェクト

            mockUserProfileRepository.getUserProfile.mockResolvedValue(currentProfile);
            mockUserProfileRepository.updateUserProfile.mockResolvedValue(updatedProfile);

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // Repository 呼び出しの確認
            expect(mockUserProfileRepository.updateUserProfile).toHaveBeenCalledWith(
                userId,
                requestBody
            );
        });
    });
});