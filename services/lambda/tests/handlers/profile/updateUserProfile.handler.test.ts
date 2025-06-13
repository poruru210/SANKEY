import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/profile/updateUserProfile.handler';
import type { UpdateUserProfileHandlerDependencies } from '../../../src/di/types';
import type { UserProfile } from '../../../src/models/userProfile';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

describe('updateUserProfile.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockDocClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: UpdateUserProfileHandlerDependencies;

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

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: currentProfile }) // GetCommand
                .mockResolvedValueOnce({ Attributes: updatedProfile }); // UpdateCommand
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Profile updated successfully');
            expect(responseBody.data.setupPhase).toBe('TEST');

            // DynamoDB 呼び出しの確認
            expect(mockSend).toHaveBeenCalledTimes(2);

            // GetCommand の確認
            const getCommand = mockSend.mock.calls[0][0];
            expect(getCommand.constructor.name).toBe('GetCommand');
            expect(getCommand.input.Key).toEqual({ userId });

            // UpdateCommand の確認
            const updateCommand = mockSend.mock.calls[1][0];
            expect(updateCommand.constructor.name).toBe('UpdateCommand');
            expect(updateCommand.input.Key).toEqual({ userId });
            expect(updateCommand.input.UpdateExpression).toContain('#setupPhase = :setupPhase');
            expect(updateCommand.input.UpdateExpression).toContain('#updatedAt = :updatedAt');
            expect(updateCommand.input.ExpressionAttributeValues[':setupPhase']).toBe('TEST');

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

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: currentProfile })
                .mockResolvedValueOnce({ Attributes: updatedProfile });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.notificationEnabled).toBe(false);

            // UpdateCommand の確認
            const updateCommand = mockSend.mock.calls[1][0];
            expect(updateCommand.input.UpdateExpression).toContain('#notificationEnabled = :notificationEnabled');
            expect(updateCommand.input.ExpressionAttributeValues[':notificationEnabled']).toBe(false);
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

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: currentProfile })
                .mockResolvedValueOnce({ Attributes: updatedProfile });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.setupPhase).toBe('PRODUCTION');
            expect(responseBody.data.notificationEnabled).toBe(false);

            // UpdateCommand の確認
            const updateCommand = mockSend.mock.calls[1][0];
            expect(updateCommand.input.UpdateExpression).toContain('#setupPhase = :setupPhase');
            expect(updateCommand.input.UpdateExpression).toContain('#notificationEnabled = :notificationEnabled');
        });
    });

    describe('異常系テスト', () => {
        it('認証情報がない場合は401を返す', async () => {
            // Arrange
            const requestBody = { setupPhase: 'TEST' };
            const event = createTestEvent(undefined, requestBody);

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

            const mockSend = vi.fn().mockResolvedValueOnce({ Item: null });
            (mockDocClient.send as any) = mockSend;

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

            const mockSend = vi.fn().mockResolvedValueOnce({ Item: currentProfile });
            (mockDocClient.send as any) = mockSend;

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

            const mockSend = vi.fn().mockResolvedValueOnce({ Item: currentProfile });
            (mockDocClient.send as any) = mockSend;

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

            const mockSend = vi.fn().mockResolvedValueOnce({ Item: currentProfile });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.errors).toContain('notificationEnabled must be a boolean');
        });

        it('DynamoDB GetCommand エラーの場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const requestBody = { setupPhase: 'TEST' };

            const mockSend = vi.fn().mockRejectedValueOnce(new Error('DynamoDB error'));
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Failed to update user profile');
        });

        it('DynamoDB UpdateCommand エラーの場合は500を返す', async () => {
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

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: currentProfile })
                .mockRejectedValueOnce(new Error('Update failed'));
            (mockDocClient.send as any) = mockSend;

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

                const mockSend = vi.fn()
                    .mockResolvedValueOnce({ Item: currentProfile })
                    .mockResolvedValueOnce({ Attributes: updatedProfile });
                (mockDocClient.send as any) = mockSend;

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

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: currentProfile })
                .mockResolvedValueOnce({ Attributes: updatedProfile });
            (mockDocClient.send as any) = mockSend;

            const event = createTestEvent(userId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // UpdateCommand の確認（updatedAtのみ更新される）
            const updateCommand = mockSend.mock.calls[1][0];
            expect(updateCommand.input.UpdateExpression).toBe('SET #updatedAt = :updatedAt');
        });
    });
});