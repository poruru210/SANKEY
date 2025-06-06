// tests/handlers/applications/rejectApplication.handler.test.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EAApplication } from '@lambda/models/eaApplication';

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

// DynamoDB Client のモック追加
vi.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: vi.fn().mockReturnValue({})
    }
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

// Middyのモック
vi.mock('@middy/core', () => ({
    default: vi.fn((handler) => {
        const wrappedHandler = async (event: any, context: any) => {
            return await handler(event, context);
        };
        wrappedHandler.use = vi.fn().mockReturnValue(wrappedHandler);
        wrappedHandler.before = vi.fn();
        wrappedHandler.after = vi.fn();
        wrappedHandler.onError = vi.fn();
        return wrappedHandler;
    })
}));

describe('rejectApplication.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/applications/rejectApplication.handler');
        handler = handlerModule.handler;
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

    // ヘルパー関数: テスト用のLambdaコンテキスト作成
    const createTestContext = () => ({
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'rejectApplication',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:rejectApplication',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/rejectApplication',
        logStreamName: '2025/06/05/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn()
    });

    describe('正常系テスト', () => {
        it('should successfully reject pending application', async () => {
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

            const rejectedApplication = { ...mockApplication, status: 'Rejected' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(rejectedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application rejected successfully');
            expect(responseBody.data.status).toBe('Rejected');
            // 修正: rejectedAt ではなく reason をチェック
            expect(responseBody.data.reason).toContain('Application rejected by developer');

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Rejected');
            expect(mockRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK: fullApplicationSK,
                action: 'Rejected',
                changedBy: userId,
                previousStatus: 'Pending',
                newStatus: 'Rejected',
                reason: expect.stringContaining('Application rejected by developer')
            });
        });

        it('should handle admin user rejecting any application', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, adminUserId);
            event.requestContext.authorizer!.claims!.role = 'admin';
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // Admin の場合、他のユーザーのアプリケーションも拒否可能
            expect(mockRepository.getApplication).toHaveBeenCalledWith(adminUserId, fullApplicationSK);
            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: expect.stringContaining('Application rejected by admin')
            }));
        });

        it('should handle custom rejection reason', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId, { reason: customReason });
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toBe(customReason);

            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: customReason
            }));
        });
    });

    describe('異常系テスト', () => {
        it('should return 400 for missing application ID', async () => {
            // Arrange
            const event = createTestEvent('');
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
            const event = createTestEvent('test-app-id');
            event.requestContext.authorizer = null; // 認証情報なし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(401);
        });

        it('should return 404 for non-existent application', async () => {
            // Arrange
            const applicationId = 'non-existent-app';
            mockRepository.getApplication.mockResolvedValueOnce(null);

            const event = createTestEvent(applicationId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(404);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application not found');
        });

        it('should return 403 for developer trying to reject another user\'s application', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, developerUserId);
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application is in Active status');
        });

        it('should return 500 for repository errors', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            mockRepository.getApplication.mockRejectedValueOnce(new Error('Database connection failed'));

            const event = createTestEvent(applicationId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to reject application');
        });

        it('should handle invalid JSON in request body gracefully', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Rejected' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            event.body = '{ invalid json'; // 不正なJSON
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200); // JSON解析に失敗してもデフォルト理由で処理される
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toContain('Application rejected by developer');
        });
    });

    describe('ステータス遷移テスト', () => {
        it('should follow correct status transition: Pending → Rejected', async () => {
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

            const rejectedApplication = { ...mockApplication, status: 'Rejected' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(rejectedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // ステータス遷移の確認
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Rejected');

            // 履歴記録の確認
            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                action: 'Rejected',
                previousStatus: 'Pending',
                newStatus: 'Rejected'
            }));
        });
    });
});