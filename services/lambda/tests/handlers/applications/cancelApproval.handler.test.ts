// tests/handlers/applications/cancelApproval.handler.test.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EAApplication } from '@lambda/models/eaApplication';

// 修正: DI対応のRepository クラスモック
const mockRepository = {
    getApplication: vi.fn(),
    cancelApplication: vi.fn(),
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

describe('cancelApproval.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/applications/cancelApproval.handler');
        handler = handlerModule.handler;
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

    // ヘルパー関数: テスト用のLambdaコンテキスト作成
    const createTestContext = () => ({
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'cancelApproval',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:cancelApproval',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/cancelApproval',
        logStreamName: '2025/06/05/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn()
    });

    describe('正常系テスト', () => {
        it('should successfully cancel application within 5 minutes', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.cancelApplication.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application approval cancelled successfully');
            expect(responseBody.data.status).toBe('Cancelled');

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockRepository.cancelApplication).toHaveBeenCalledWith(
                userId,
                fullApplicationSK,
                expect.stringContaining('Cancelled by user within')
            );
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
            expect(responseBody.message).toContain('Missing application ID parameter');
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

        it('should return 400 for application not in AwaitingNotification status', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application cannot be cancelled');
        });

        it('should return 400 for cancellation after 5 minutes', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Cancellation period expired');
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
            expect(responseBody.message).toContain('Failed to cancel application approval');
        });
    });

    describe('時間チェックテスト', () => {
        it('should calculate time difference correctly using updatedAt', async () => {
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

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.cancelApplication.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // cancelApplication が適切な理由で呼ばれた
            expect(mockRepository.cancelApplication).toHaveBeenCalledWith(
                userId,
                fullApplicationSK,
                expect.stringMatching(/Cancelled by user within \d+ seconds of approval/)
            );
        });
    });
});