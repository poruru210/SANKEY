// tests/handlers/applications/getApplications.handler.test.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EAApplication } from '@lambda/models/eaApplication';

// DI対応のRepository クラスモック
const mockRepository = {
    getAllApplications: vi.fn(),
};

vi.mock('../../../src/repositories/eaApplicationRepository', () => ({
    EAApplicationRepository: vi.fn().mockImplementation(() => mockRepository)
}));

// DynamoDB Client のモック
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

describe('getApplications.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/applications/getApplications.handler');
        handler = handlerModule.handler;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (
        userId: string = 'test-user-123'
    ): APIGatewayProxyEvent => ({
        httpMethod: 'GET',
        path: '/applications',
        pathParameters: null,
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
        functionName: 'getApplications',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:getApplications',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/getApplications',
        logStreamName: '2025/06/05/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn()
    });

    // ヘルパー関数: サンプルアプリケーション作成
    const createMockApplication = (
        id: string,
        status: EAApplication['status'],
        additionalProps: Partial<EAApplication> = {}
    ): EAApplication => ({
        userId: 'test-user-123',
        sk: `APPLICATION#${id}`,
        broker: 'TestBroker',
        accountNumber: '123456',
        eaName: 'TestEA',
        email: 'test@example.com',
        xAccount: '@test',
        status,
        appliedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T01:00:00Z',
        ...additionalProps
    });

    describe('正常系テスト', () => {
        it('should successfully return empty applications list', async () => {
            // Arrange
            const userId = 'test-user-123';

            mockRepository.getAllApplications.mockResolvedValueOnce([]);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Applications retrieved successfully');
            expect(responseBody.data).toEqual({
                pending: [],
                awaitingNotification: [],
                active: [],
                history: [],
                count: {
                    pending: 0,
                    awaitingNotification: 0,
                    active: 0,
                    history: 0,
                    total: 0
                }
            });

            expect(mockRepository.getAllApplications).toHaveBeenCalledWith(userId);
        });

        it('should successfully return applications grouped by status', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplications: EAApplication[] = [
                createMockApplication('1', 'Pending'),
                createMockApplication('2', 'AwaitingNotification', {
                    notificationScheduledAt: '2025-01-01T01:05:00Z'
                }),
                createMockApplication('3', 'Active', {
                    licenseKey: 'license-123',
                    expiryDate: '2025-12-31T23:59:59Z'
                }),
                createMockApplication('4', 'Cancelled'),
                createMockApplication('5', 'Rejected'),
                createMockApplication('6', 'Revoked'),
                createMockApplication('7', 'Expired')
            ];

            mockRepository.getAllApplications.mockResolvedValueOnce(mockApplications);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.data.count).toEqual({
                pending: 1,
                awaitingNotification: 1,
                active: 1,
                history: 4, // Cancelled, Rejected, Revoked, Expired
                total: 7
            });

            // Pending アプリケーション
            expect(responseBody.data.pending).toHaveLength(1);
            expect(responseBody.data.pending[0]).toMatchObject({
                id: 'APPLICATION#1',
                status: 'Pending',
                eaName: 'TestEA',
                accountNumber: '123456'
            });

            // AwaitingNotification アプリケーション
            expect(responseBody.data.awaitingNotification).toHaveLength(1);
            expect(responseBody.data.awaitingNotification[0]).toMatchObject({
                id: 'APPLICATION#2',
                status: 'AwaitingNotification',
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            });

            // Active アプリケーション
            expect(responseBody.data.active).toHaveLength(1);
            expect(responseBody.data.active[0]).toMatchObject({
                id: 'APPLICATION#3',
                status: 'Active',
                licenseKey: 'license-123',
                expiryDate: '2025-12-31T23:59:59Z'
            });

            // History アプリケーション
            expect(responseBody.data.history).toHaveLength(4);
            const historyStatuses = responseBody.data.history.map((app: any) => app.status);
            expect(historyStatuses).toContain('Cancelled');
            expect(historyStatuses).toContain('Rejected');
            expect(historyStatuses).toContain('Revoked');
            expect(historyStatuses).toContain('Expired');
        });

        it('should handle applications with notificationScheduledAt field', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplications: EAApplication[] = [
                createMockApplication('1', 'AwaitingNotification', {
                    notificationScheduledAt: '2025-01-01T01:05:00Z'
                }),
                createMockApplication('2', 'AwaitingNotification', {
                    notificationScheduledAt: '2025-01-01T01:10:00Z'
                })
            ];

            mockRepository.getAllApplications.mockResolvedValueOnce(mockApplications);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.awaitingNotification).toHaveLength(2);

            // notificationScheduledAt フィールドが正しく含まれている
            expect(responseBody.data.awaitingNotification[0].notificationScheduledAt).toBe('2025-01-01T01:05:00Z');
            expect(responseBody.data.awaitingNotification[1].notificationScheduledAt).toBe('2025-01-01T01:10:00Z');
        });

        it('should return complete application summary fields', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplication = createMockApplication('1', 'Active', {
                licenseKey: 'encrypted-license-key-123',
                expiryDate: '2025-12-31T23:59:59Z',
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            });

            mockRepository.getAllApplications.mockResolvedValueOnce([mockApplication]);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            const activeApp = responseBody.data.active[0];

            // 全フィールドが正しく変換されている
            expect(activeApp).toEqual({
                id: 'APPLICATION#1',
                accountNumber: '123456',
                eaName: 'TestEA',
                broker: 'TestBroker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                notificationScheduledAt: '2025-01-01T01:05:00Z',
                expiryDate: '2025-12-31T23:59:59Z',
                licenseKey: 'encrypted-license-key-123'
            });
        });
    });

    describe('異常系テスト', () => {
        it('should return 401 for missing user authentication', async () => {
            // Arrange
            const event = createTestEvent();
            event.requestContext.authorizer = null; // 認証情報なし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('User ID not found in authorization context');
        });

        it('should return 401 for missing user ID in claims', async () => {
            // Arrange
            const event = createTestEvent();
            event.requestContext.authorizer!.claims = {}; // sub なし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('User ID not found in authorization context');
        });

        it('should return 500 for repository errors', async () => {
            // Arrange
            const userId = 'test-user-123';
            mockRepository.getAllApplications.mockRejectedValueOnce(new Error('Database connection failed'));

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to retrieve applications');
        });

        it('should handle empty applications gracefully', async () => {
            // Arrange
            const userId = 'test-user-123';
            mockRepository.getAllApplications.mockResolvedValueOnce([]);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.count.total).toBe(0);
            expect(responseBody.data.pending).toEqual([]);
            expect(responseBody.data.awaitingNotification).toEqual([]);
            expect(responseBody.data.active).toEqual([]);
            expect(responseBody.data.history).toEqual([]);
        });
    });

    describe('データ変換テスト', () => {
        it('should correctly transform application data to summary format', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplication = createMockApplication('test-id', 'Pending', {
                broker: 'CustomBroker',
                accountNumber: '999888',
                eaName: 'CustomEA',
                email: 'custom@example.com',
                xAccount: '@custom'
            });

            mockRepository.getAllApplications.mockResolvedValueOnce([mockApplication]);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            const pendingApp = responseBody.data.pending[0];

            expect(pendingApp.id).toBe('APPLICATION#test-id');
            expect(pendingApp.broker).toBe('CustomBroker');
            expect(pendingApp.accountNumber).toBe('999888');
            expect(pendingApp.eaName).toBe('CustomEA');
            expect(pendingApp.email).toBe('custom@example.com');
            expect(pendingApp.xAccount).toBe('@custom');
        });

        it('should handle applications without optional fields', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplication = createMockApplication('1', 'Pending');
            // notificationScheduledAt, expiryDate, licenseKey は未設定

            mockRepository.getAllApplications.mockResolvedValueOnce([mockApplication]);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            const pendingApp = responseBody.data.pending[0];

            expect(pendingApp.notificationScheduledAt).toBeUndefined();
            expect(pendingApp.expiryDate).toBeUndefined();
            expect(pendingApp.licenseKey).toBeUndefined();
        });
    });

    describe('ステータス別グループ化テスト', () => {
        it('should correctly group all possible statuses', async () => {
            // Arrange
            const userId = 'test-user-123';

            const mockApplications: EAApplication[] = [
                createMockApplication('1', 'Pending'),
                createMockApplication('2', 'Approve'),
                createMockApplication('3', 'AwaitingNotification'),
                createMockApplication('4', 'Active'),
                createMockApplication('5', 'Cancelled'),
                createMockApplication('6', 'Rejected'),
                createMockApplication('7', 'Revoked'),
                createMockApplication('8', 'Expired')
            ];

            mockRepository.getAllApplications.mockResolvedValueOnce(mockApplications);

            const event = createTestEvent(userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);

            // Pending: Pending のみ
            expect(responseBody.data.pending.map((app: any) => app.status)).toEqual(['Pending']);

            // AwaitingNotification: AwaitingNotification のみ
            expect(responseBody.data.awaitingNotification.map((app: any) => app.status)).toEqual(['AwaitingNotification']);

            // Active: Active のみ
            expect(responseBody.data.active.map((app: any) => app.status)).toEqual(['Active']);

            // History: Cancelled, Rejected, Revoked, Expired
            const historyStatuses = responseBody.data.history.map((app: any) => app.status).sort();
            expect(historyStatuses).toEqual(['Cancelled', 'Expired', 'Rejected', 'Revoked']);

            // Approve ステータスはどのグループにも含まれない（想定される動作）
            expect(responseBody.data.count.total).toBe(8);
            expect(responseBody.data.count.pending +
                responseBody.data.count.awaitingNotification +
                responseBody.data.count.active +
                responseBody.data.count.history).toBe(7); // Approve は除外される
        });
    });
});