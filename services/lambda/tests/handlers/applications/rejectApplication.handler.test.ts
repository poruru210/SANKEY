import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/applications/rejectApplication.handler';
import type { RejectApplicationHandlerDependencies } from '../../../src/di/types';
import type { EAApplication } from '../../../src/models/eaApplication';

describe('rejectApplication.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: RejectApplicationHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEAApplicationRepository,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (
        applicationId: string,
        userId: string = 'test-user-123',
        requestBody?: any
    ): APIGatewayProxyEvent => ({
        httpMethod: 'POST',
        path: `/applications/${applicationId}/reject`,
        pathParameters: { id: applicationId },
        body: requestBody ? JSON.stringify(requestBody) : null,
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        isBase64Encoded: false,
        requestContext: {
            authorizer: {
                claims: {
                    sub: userId
                }
            }
        } as any,
        resource: '',
        stageVariables: null
    });

    describe('正常系テスト', () => {
        it('保留中のアプリケーションを正常に拒否する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const rejectedApplication = { ...mockApplication, status: 'Rejected' as const };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce(rejectedApplication);
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application rejected successfully');
            expect(responseBody.data.status).toBe('Rejected');
            expect(responseBody.data.reason).toContain('Application rejected by developer');

            // Repository メソッドの呼び出し確認
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Rejected');
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK: fullApplicationSK,
                action: 'Rejected',
                changedBy: userId,
                previousStatus: 'Pending',
                newStatus: 'Rejected',
                reason: expect.stringContaining('Application rejected by developer')
            });
        });

        it('管理者は任意のアプリケーションを拒否できる', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const adminUserId = 'admin-user-456';
            const applicationOwnerUserId = 'owner-user-789';

            const mockApplication: EAApplication = {
                userId: applicationOwnerUserId, // 他のユーザーのアプリケーション
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' as const });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, adminUserId);
            event.requestContext.authorizer!.claims!.role = 'admin';

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // Admin の場合、他のユーザーのアプリケーションも拒否可能
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(adminUserId, fullApplicationSK);
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: expect.stringContaining('Application rejected by admin')
            }));
        });

        it('カスタム拒否理由を処理する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';
            const customReason = 'Does not meet requirements';

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' as const });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId, { reason: customReason });

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toBe(customReason);

            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: customReason
            }));
        });
    });

    describe('異常系テスト', () => {
        it('アプリケーションIDがない場合は400を返す', async () => {
            // Arrange
            const event = createTestEvent('');
            event.pathParameters = null; // ID なし

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Application ID is required');
        });

        it('ユーザー認証がない場合は401を返す', async () => {
            // Arrange
            const event = createTestEvent('test-app-id');
            event.requestContext.authorizer = null; // 認証情報なし

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
        });

        it('アプリケーションが存在しない場合は404を返す', async () => {
            // Arrange
            const applicationId = 'non-existent-app';
            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(null);

            const event = createTestEvent(applicationId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(404);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application not found');
        });

        it('開発者が他のユーザーのアプリケーションを拒否しようとした場合は403を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const developerUserId = 'developer-user-123';
            const ownerUserId = 'owner-user-456';

            const mockApplication: EAApplication = {
                userId: ownerUserId, // 他のユーザーが所有
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, developerUserId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(403);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Access denied');
        });

        it('アプリケーションがPending状態でない場合は400を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Active', // Pending ではない
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application is in Active status');
        });

        it('リポジトリエラーの場合は500を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            mockEAApplicationRepository.getApplication.mockRejectedValueOnce(new Error('Database connection failed'));

            const event = createTestEvent(applicationId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to reject application');
        });

        it('リクエストボディの無効なJSONを適切に処理する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' as const });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            event.body = '{ invalid json'; // 不正なJSON

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200); // JSON解析に失敗してもデフォルト理由で処理される
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toContain('Application rejected by developer');
        });
    });

    describe('ステータス遷移テスト', () => {
        it('正しいステータス遷移に従う: Pending → Rejected', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const rejectedApplication = { ...mockApplication, status: 'Rejected' as const };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce(rejectedApplication);
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // ステータス遷移の確認
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Rejected');

            // 履歴記録の確認
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                action: 'Rejected',
                previousStatus: 'Pending',
                newStatus: 'Rejected'
            }));
        });
    });
});