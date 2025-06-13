import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/applications/approveApplication.handler';
import type { ApproveApplicationHandlerDependencies } from '../../../src/di/types';
import type { EAApplication } from '../../../src/models/eaApplication';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

describe('approveApplication.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockSQSClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: ApproveApplicationHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.test.amazonaws.com/queue/test-queue';
        process.env.SQS_DELAY_SECONDS = '300';

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockSQSClient = container.resolve('sqsClient');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEAApplicationRepository,
            sqsClient: mockSQSClient,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.NOTIFICATION_QUEUE_URL;
        delete process.env.SQS_DELAY_SECONDS;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (
        applicationId: string,
        requestBody: any,
        userId: string = 'test-user-123',
        userRole: string = 'developer'
    ): APIGatewayProxyEvent => ({
        httpMethod: 'POST',
        path: `/applications/${applicationId}/approve`,
        pathParameters: { id: applicationId },
        body: JSON.stringify(requestBody),
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        isBase64Encoded: false,
        requestContext: {
            authorizer: {
                claims: {
                    sub: userId,
                    role: userRole
                }
            }
        } as any,
        resource: '',
        stageVariables: null
    });

    describe('正常系テスト', () => {
        it('アプリケーションを正常に承認し、完全なワークフローを実行する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

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

            // Repository メソッドのモック設定
            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Approve' });
            mockEAApplicationRepository.recordHistory.mockResolvedValue(undefined);

            // SQS のモック設定
            const mockSend = vi.fn().mockResolvedValue({ MessageId: 'test-message-id' });
            (mockSQSClient.send as any) = mockSend;

            const event = createTestEvent(applicationId, requestBody, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application approved successfully');
            expect(responseBody.data.status).toBe('AwaitingNotification');
            expect(responseBody.data.applicationId).toBe(applicationId);
            expect(responseBody.data.notificationScheduledAt).toBeDefined();

            // Repository メソッドの呼び出し確認
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenCalledTimes(2);
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledTimes(2);

            // SQS メッセージ送信の確認
            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    constructor: expect.objectContaining({
                        name: 'SendMessageCommand'
                    })
                })
            );
        });

        it('管理者は任意のアプリケーションを承認できる', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const adminUserId = 'admin-user-456';
            const applicationOwnerUserId = 'owner-user-789';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const mockApplication: EAApplication = {
                userId: applicationOwnerUserId,
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
            mockEAApplicationRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockEAApplicationRepository.recordHistory.mockResolvedValue(undefined);

            const mockSend = vi.fn().mockResolvedValue({ MessageId: 'test-message-id' });
            (mockSQSClient.send as any) = mockSend;

            const event = createTestEvent(applicationId, requestBody, adminUserId, 'admin');

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: 'Application approved by admin: admin-user-456'
                })
            );
        });
    });

    describe('異常系テスト', () => {
        it('アプリケーションIDがない場合は400を返す', async () => {
            // Arrange
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('', requestBody);
            event.pathParameters = null;

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
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('test-app-id', requestBody);
            event.requestContext.authorizer = null;

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
        });

        it('必須パラメータが不足している場合は400を返す', async () => {
            // Arrange
            const incompleteRequestBody = {
                eaName: 'TestEA'
                // accountId, expiry, email, broker が不足
            };

            const event = createTestEvent('test-app-id', incompleteRequestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Missing required parameters');
        });

        it('有効期限が無効な場合は400を返す', async () => {
            // Arrange
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2020-01-01T00:00:00Z', // 過去の日付
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('test-app-id', requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Invalid expiry date');
        });

        it('アプリケーションが存在しない場合は404を返す', async () => {
            // Arrange
            const applicationId = 'non-existent-app';
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(null);

            const event = createTestEvent(applicationId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(404);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application not found');
        });

        it('開発者が他のユーザーのアプリケーションを承認しようとした場合は403を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const developerUserId = 'developer-user-123';
            const ownerUserId = 'owner-user-456';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const mockApplication: EAApplication = {
                userId: ownerUserId,
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

            const event = createTestEvent(applicationId, requestBody, developerUserId, 'developer');

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

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Active', // すでに Active 状態
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, requestBody, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application is in Active status, expected Pending');
        });

        it('リポジトリエラーの場合は500を返す', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            mockEAApplicationRepository.getApplication.mockRejectedValueOnce(new Error('Database connection failed'));

            const event = createTestEvent(applicationId, requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to approve application');
        });

        it('SQS送信が失敗した場合のエラーハンドリング', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

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
            mockEAApplicationRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockEAApplicationRepository.recordHistory.mockResolvedValue(undefined);

            // SQS エラーを設定
            const mockSend = vi.fn().mockRejectedValue(new Error('SQS send failed'));
            (mockSQSClient.send as any) = mockSend;

            const event = createTestEvent(applicationId, requestBody, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to approve application');
        });
    });

    describe('ステータス遷移テスト', () => {
        it('正しいステータス遷移に従う: Pending → Approve → AwaitingNotification', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

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
            mockEAApplicationRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockEAApplicationRepository.recordHistory.mockResolvedValue(undefined);

            const mockSend = vi.fn().mockResolvedValue({ MessageId: 'test-message-id' });
            (mockSQSClient.send as any) = mockSend;

            const event = createTestEvent(applicationId, requestBody, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // ステータス遷移の順序確認
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenNthCalledWith(1, userId, fullApplicationSK, 'Approve', expect.any(Object));
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenNthCalledWith(2, userId, fullApplicationSK, 'AwaitingNotification', expect.any(Object));

            // 履歴記録の順序確認
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({
                action: 'Approve',
                previousStatus: 'Pending',
                newStatus: 'Approve'
            }));

            expect(mockEAApplicationRepository.recordHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({
                action: 'AwaitingNotification',
                previousStatus: 'Approve',
                newStatus: 'AwaitingNotification'
            }));
        });
    });

    describe('SQS メッセージ内容テスト', () => {
        it('SQSキューに正しいメッセージを送信する', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';

            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

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
            mockEAApplicationRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockEAApplicationRepository.recordHistory.mockResolvedValue(undefined);

            const mockSend = vi.fn().mockResolvedValue({ MessageId: 'test-message-id' });
            (mockSQSClient.send as any) = mockSend;

            const event = createTestEvent(applicationId, requestBody, userId);

            // Act
            await handler(event);

            // Assert
            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        QueueUrl: 'https://sqs.test.amazonaws.com/queue/test-queue',
                        MessageBody: expect.stringContaining('"applicationSK":"APPLICATION#'),
                        DelaySeconds: 300
                    })
                })
            );
        });
    });
});