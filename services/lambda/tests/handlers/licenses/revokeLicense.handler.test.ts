// tests/handlers/applications/revokeLicense.handler.test.ts

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

describe('revokeLicense.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/licenses/revokeLicense.handler');
        handler = handlerModule.handler;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (
        applicationId: string,
        requestBody?: any,
        userId: string = 'test-user-123'
    ): APIGatewayProxyEvent => ({
        httpMethod: 'POST',
        path: `/applications/${applicationId}/revoke`,
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
        functionName: 'revokeLicense',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:revokeLicense',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/revokeLicense',
        logStreamName: '2025/06/05/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: vi.fn(),
        fail: vi.fn(),
        succeed: vi.fn()
    });

    describe('正常系テスト', () => {
        it('should successfully revoke active application with reason', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const fullApplicationSK = `APPLICATION#${applicationId}`;
            const userId = 'test-user-123';
            const requestBody = { reason: 'Security violation detected' };

            const mockApplication: EAApplication = {
                userId,
                sk: fullApplicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-123'
            };

            const revokedApplication = { ...mockApplication, status: 'Revoked' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(revokedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, requestBody, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('License revoked successfully'); // 修正: 実装に合わせる
            expect(responseBody.data.status).toBe('Revoked');
            expect(responseBody.data.reason).toBe('Security violation detected');
            expect(responseBody.data.licenseKey).toContain('...'); // 修正: 一部のみ表示

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, fullApplicationSK);
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Revoked');
            expect(mockRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK: fullApplicationSK,
                action: 'Revoked',
                changedBy: userId,
                previousStatus: 'Active',
                newStatus: 'Revoked',
                reason: 'Security violation detected'
            });
        });

        it('should successfully revoke active application without reason', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-123'
            };

            const revokedApplication = { ...mockApplication, status: 'Revoked' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(revokedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId); // reasonなし
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toBe('License revoked by developer: test-user-123'); // 修正: 実装に合わせる

            expect(mockRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK: fullApplicationSK,
                action: 'Revoked',
                changedBy: userId,
                previousStatus: 'Active',
                newStatus: 'Revoked',
                reason: 'License revoked by developer: test-user-123'
            });
        });

        it('should handle admin user revoking any application', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-456'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'Revoked' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, undefined, adminUserId);
            event.requestContext.authorizer!.claims!.role = 'admin';
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // Admin の場合、他のユーザーのライセンスも失効可能
            expect(mockRepository.getApplication).toHaveBeenCalledWith(adminUserId, fullApplicationSK);
            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                reason: 'License revoked by admin: admin-user-456'
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

        it('should return 403 for developer trying to revoke another user\'s license', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-123'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, undefined, developerUserId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(403);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Access denied');
        });

        it('should return 400 for application not in Active status', async () => {
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
                status: 'Pending', // Active ではない
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, undefined, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('Application is in Pending status. Only Active licenses can be revoked');
        });

        it('should return 400 for application without license key', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
                // licenseKey なし
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            const event = createTestEvent(applicationId, undefined, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toContain('No license key found for this application');
        });

        it('should handle invalid JSON body gracefully', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-123'
            };

            const revokedApplication = { ...mockApplication, status: 'Revoked' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(revokedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, undefined, userId);
            event.body = '{ invalid json }'; // 不正なJSON
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200); // JSONパースエラーでも処理継続
            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.reason).toBe('License revoked by developer: test-user-123'); // デフォルト理由を使用
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
            expect(responseBody.message).toContain('Failed to revoke license');
        });
    });

    describe('ステータス遷移テスト', () => {
        it('should follow correct status transition: Active → Revoked', async () => {
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
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                licenseKey: 'encrypted-license-123'
            };

            const revokedApplication = { ...mockApplication, status: 'Revoked' };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(revokedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            const event = createTestEvent(applicationId, undefined, userId);
            const context = createTestContext();

            // Act
            const result = await handler(event, context);

            // Assert
            expect(result.statusCode).toBe(200);

            // ステータス遷移の確認
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(userId, fullApplicationSK, 'Revoked');

            // 履歴記録の確認
            expect(mockRepository.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
                action: 'Revoked',
                previousStatus: 'Active',
                newStatus: 'Revoked'
            }));
        });
    });
});