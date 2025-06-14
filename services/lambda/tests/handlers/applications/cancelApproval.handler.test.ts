import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/applications/cancelApproval.handler';
import type { DIContainer, CancelApprovalHandlerDependencies } from '../../../src/di/dependencies';
import type { EAApplication } from '../../../src/models/eaApplication';

describe('cancelApproval.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: CancelApprovalHandlerDependencies;

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
        userId: string = 'test-user-123'
    ): APIGatewayProxyEvent => ({
        httpMethod: 'POST',
        path: `/applications/${applicationId}/cancel`,
        pathParameters: { id: applicationId },
        body: null,
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
        it('5分以内にアプリケーションを正常にキャンセルする', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            // 3分前に更新されたアプリケーション（5分以内）
            const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: threeMinutesAgo
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.cancelApplication.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application approval cancelled successfully');
            expect(responseBody.data.status).toBe('Cancelled');

            // Repository メソッドの呼び出し確認
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockEAApplicationRepository.cancelApplication).toHaveBeenCalledWith(
                userId,
                fullApplicationSK,
                expect.stringContaining('Cancelled by user within')
            );
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
            expect(responseBody.message).toContain('Missing application ID parameter');
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

        it('アプリケーションがAwaitingNotification状態でない場合は400を返す', async () => {
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
                status: 'Active', // AwaitingNotification ではない
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
            expect(responseBody.message).toContain('Application cannot be cancelled');
        });

        it('5分経過後のキャンセルは400を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            // 6分前に更新されたアプリケーション（5分超過）
            const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: sixMinutesAgo
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Cancellation period expired');
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
            expect(responseBody.message).toContain('Failed to cancel application approval');
        });
    });

    describe('時間チェックテスト', () => {
        it('updatedAtを使用して時間差を正しく計算する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            // 正確に4分59秒前（5分以内の境界値）
            const almostFiveMinutes = new Date(Date.now() - 4 * 60 * 1000 - 59 * 1000).toISOString();

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: almostFiveMinutes
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.cancelApplication.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // cancelApplication が適切な理由で呼ばれた
            expect(mockEAApplicationRepository.cancelApplication).toHaveBeenCalledWith(
                userId,
                fullApplicationSK,
                expect.stringMatching(/Cancelled by user within \d+ seconds of approval/)
            );
        });
    });
});