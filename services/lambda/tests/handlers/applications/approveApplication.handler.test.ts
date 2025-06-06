// tests/handlers/applications/approveApplication.handler.test.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EAApplication } from '@lambda/models/eaApplication';

// SQS Client のモック
const sqsMock = mockClient(SQSClient);

// 修正: DI対応のRepository クラスモック
const mockRepository = {
    getApplication: vi.fn(),
    updateStatus: vi.fn(),
    recordHistory: vi.fn(),
};

// 修正: DIクラスモックに変更
vi.mock('../../../src/repositories/eaApplicationRepository', () => ({
    EAApplicationRepository: vi.fn().mockImplementation(() => mockRepository)
}));

// PowerTools のモック
vi.mock('@aws-lambda-powertools/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }))
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
    Tracer: vi.fn().mockImplementation(() => ({
        captureAWSv3Client: vi.fn((client) => client),
        isTracingEnabled: vi.fn(() => false),
        getSegment: vi.fn(),
        setSegment: vi.fn(),
        addAnnotation: vi.fn(),
        addMetadata: vi.fn(),
        putAnnotation: vi.fn(),
        putMetadata: vi.fn(),
        annotateColdStart: vi.fn(),
        addServiceNameAnnotation: vi.fn(),
        addResponseAsMetadata: vi.fn(),
        captureLambdaHandler: vi.fn((handler) => handler),
        captureMethod: vi.fn(),
        captureAsyncFunc: vi.fn()
    }))
}));

// DynamoDB Client のモック追加
vi.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: vi.fn().mockReturnValue({})
    }
}));

// Middyのモック
vi.mock('@middy/core', () => ({
    default: vi.fn((handler) => {
        // Middyでラップされた関数を直接返すように修正
        const wrappedHandler = async (event: any, context: any) => {
            return await handler(event, context);
        };

        // use, before, after, onError メソッドを追加しつつ、
        // 関数として呼び出せるように設定
        wrappedHandler.use = vi.fn().mockReturnValue(wrappedHandler);
        wrappedHandler.before = vi.fn();
        wrappedHandler.after = vi.fn();
        wrappedHandler.onError = vi.fn();

        return wrappedHandler;
    })
}));

describe('approveApplication.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        sqsMock.reset();
        process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.test.amazonaws.com/queue/test-queue';

        const handlerModule = await import('../../../src/handlers/applications/approveApplication.handler');
        handler = handlerModule.handler;
    });

    afterEach(() => {
        delete process.env.NOTIFICATION_QUEUE_URL;
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

    // ヘルパー関数: テスト用のLambdaコンテキスト作成
    const createTestContext = () => ({
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'approveApplication',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:approveApplication',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/approveApplication',
        logStreamName: '2025/06/05/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn()
    });

    describe('正常系テスト', () => {
        it('should successfully approve application with complete workflow', async () => {
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
            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Approve' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'AwaitingNotification' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // SQS のモック設定
            sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application approved successfully');
            expect(responseBody.data.status).toBe('AwaitingNotification');
            expect(responseBody.data.applicationId).toBe(applicationId);

            // 修正: notificationScheduledAt の存在確認
            expect(responseBody.data.notificationScheduledAt).toBeDefined();
            expect(typeof responseBody.data.notificationScheduledAt).toBe('string');

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockRepository.updateStatus).toHaveBeenCalledTimes(2);
            expect(mockRepository.recordHistory).toHaveBeenCalledTimes(2);

            // 1回目の updateStatus (Pending → Approve)
            expect(mockRepository.updateStatus).toHaveBeenNthCalledWith(1, userId, fullApplicationSK, 'Approve', {
                eaName: 'TestEA',
                email: 'test@example.com',
                broker: 'TestBroker',
                expiryDate: '2025-12-31T23:59:59.000Z'
            });

            // 1回目の recordHistory (Approve)
            expect(mockRepository.recordHistory).toHaveBeenNthCalledWith(1, {
                userId,
                applicationSK: fullApplicationSK,
                action: 'Approve',
                changedBy: userId,
                previousStatus: 'Pending',
                newStatus: 'Approve',
                reason: 'Application approved by developer: test-user-123'
            });

            // 修正: 2回目の updateStatus で notificationScheduledAt が設定されることを確認
            expect(mockRepository.updateStatus).toHaveBeenNthCalledWith(2, userId, fullApplicationSK, 'AwaitingNotification',
                expect.objectContaining({
                    notificationScheduledAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
                })
            );

            // 2回目の recordHistory (AwaitingNotification)
            expect(mockRepository.recordHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({
                userId,
                applicationSK: fullApplicationSK,
                action: 'AwaitingNotification',
                changedBy: 'system',
                previousStatus: 'Approve',
                newStatus: 'AwaitingNotification',
                reason: expect.stringContaining('License generation scheduled for')
            }));

            // SQS メッセージ送信の確認
            expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
        });

        it('should handle admin user approving any application', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockRepository.recordHistory.mockResolvedValue(undefined);
            sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

            const event = createTestEvent(applicationId, requestBody, adminUserId, 'admin');
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // Admin の場合、他のユーザーのアプリケーションも承認可能
            expect(mockRepository.getApplication).toHaveBeenCalledWith(adminUserId, fullApplicationSK);
            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: 'Application approved by admin: admin-user-456'
            }));
        });
    });

    describe('異常系テスト', () => {
        it('should return 400 for missing application ID', async () => {
            // Arrange
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('', requestBody);
            event.pathParameters = null; // ID なし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Application ID is required');
        });

        it('should return 401 for missing user authentication', async () => {
            // Arrange
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('test-app-id', requestBody);
            event.requestContext.authorizer = null; // 認証情報なし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(401);
        });

        it('should return 400 for missing required parameters', async () => {
            // Arrange
            const incompleteRequestBody = {
                eaName: 'TestEA',
                // accountId, expiry, email, broker が不足
            };

            const event = createTestEvent('test-app-id', incompleteRequestBody);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Missing required parameters');
        });

        it('should return 400 for invalid expiry date', async () => {
            // Arrange
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2020-01-01T00:00:00Z', // 過去の日付
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            const event = createTestEvent('test-app-id', requestBody);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Invalid expiry date');
        });

        it('should return 404 for non-existent application', async () => {
            // Arrange
            const applicationId = 'non-existent-app';
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            mockRepository.getApplication.mockResolvedValueOnce(null); // アプリケーションが見つからない

            const event = createTestEvent(applicationId, requestBody);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(404);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application not found');
        });

        it('should return 403 for developer trying to approve another user\'s application', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, requestBody, developerUserId, 'developer');
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(403);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Access denied');
        });

        it('should return 400 for application not in Pending status', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application is in Active status, expected Pending');
        });

        it('should return 500 for repository errors', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const requestBody = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                email: 'test@example.com',
                broker: 'TestBroker'
            };

            mockRepository.getApplication.mockRejectedValueOnce(new Error('Database connection failed'));

            const event = createTestEvent(applicationId, requestBody);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to approve application');
        });

        it('should handle SQS send failure', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockRepository.recordHistory.mockResolvedValue(undefined);

            // SQS エラーを設定
            sqsMock.on(SendMessageCommand).rejects(new Error('SQS send failed'));

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to approve application');
        });
    });

    describe('ステータス遷移テスト', () => {
        it('should follow correct status transition: Pending → Approve → AwaitingNotification', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockRepository.recordHistory.mockResolvedValue(undefined);
            sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // ステータス遷移の順序確認
            expect(mockRepository.updateStatus).toHaveBeenNthCalledWith(1, userId, fullApplicationSK, 'Approve', expect.any(Object));
            expect(mockRepository.updateStatus).toHaveBeenNthCalledWith(2, userId, fullApplicationSK, 'AwaitingNotification', expect.any(Object));

            // 履歴記録の順序確認
            expect(mockRepository.recordHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({
                action: 'Approve',
                previousStatus: 'Pending',
                newStatus: 'Approve'
            }));

            expect(mockRepository.recordHistory).toHaveBeenNthCalledWith(2, expect.objectContaining({
                action: 'AwaitingNotification',
                previousStatus: 'Approve',
                newStatus: 'AwaitingNotification'
            }));
        });
    });

    describe('SQS メッセージ内容テスト', () => {
        it('should send correct message to SQS queue', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValue({ ...mockApplication, status: 'Approve' });
            mockRepository.recordHistory.mockResolvedValue(undefined);
            sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            await handler(event, context);

            // Assert
            const sendMessageCalls = sqsMock.commandCalls(SendMessageCommand);
            expect(sendMessageCalls).toHaveLength(1);
            expect(sendMessageCalls[0].args[0].input).toEqual({
                QueueUrl: 'https://sqs.test.amazonaws.com/queue/test-queue',
                MessageBody: expect.stringContaining('"applicationSK":"APPLICATION#'),
                DelaySeconds: 300
            });
        });
    });
});