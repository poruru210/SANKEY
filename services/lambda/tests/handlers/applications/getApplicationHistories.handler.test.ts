// tests/handlers/applications/getApplicationHistories.handler.test.ts

import { APIGatewayProxyEvent } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EAApplicationHistory } from '../../../src/models/eaApplication';

// Repository のモック
const mockRepository = {
    getApplicationHistories: vi.fn(),
};

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
    }))
}));

// DynamoDB のモック
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
        const wrappedHandler = async (event: any, context: any) => {
            return await handler(event, context);
        };
        wrappedHandler.use = vi.fn().mockReturnValue(wrappedHandler);
        return wrappedHandler;
    })
}));

describe('getApplicationHistories.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/applications/getApplicationHistories.handler');
        handler = handlerModule.handler;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (
        applicationId: string,
        userId: string = 'test-user-123'
    ): APIGatewayProxyEvent => ({
        httpMethod: 'GET',
        path: `/applications/${applicationId}/histories`,
        pathParameters: { id: applicationId },
        queryStringParameters: null,
        headers: {},
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        body: null,
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
        it('should successfully retrieve application histories', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const mockHistories: EAApplicationHistory[] = [
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:30:00Z',
                    action: 'Active',
                    changedBy: 'system',
                    changedAt: '2025-06-05T15:30:00Z',
                    previousStatus: 'AwaitingNotification',
                    newStatus: 'Active',
                    reason: 'License generated and email sent successfully'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:25:00Z',
                    action: 'AwaitingNotification',
                    changedBy: 'admin-user',
                    changedAt: '2025-06-05T15:25:00Z',
                    previousStatus: 'Pending',
                    newStatus: 'AwaitingNotification',
                    reason: 'Application approved by administrator'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:20:00Z',
                    action: 'Created',
                    changedBy: userId,
                    changedAt: '2025-06-05T15:20:00Z',
                    newStatus: 'Pending',
                    reason: 'Application created'
                }
            ];

            mockRepository.getApplicationHistories.mockResolvedValueOnce(mockHistories);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application histories retrieved successfully');
            expect(responseBody.data.id).toBe(applicationId);
            expect(responseBody.data.histories).toHaveLength(3);
            expect(responseBody.data.histories[0].action).toBe('Active');

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplicationHistories).toHaveBeenCalledWith(
                userId,
                applicationId
            );
        });

        it('should return empty array when no histories found', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#NoHistory';
            const userId = 'test-user-123';

            mockRepository.getApplicationHistories.mockResolvedValueOnce([]);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.data.histories).toEqual([]);
        });

        it('should handle encoded application ID correctly', async () => {
            // Arrange
            const originalId = '2025-01-01T00:00:00Z#TestBroker#123456#Test EA';
            const encodedId = encodeURIComponent(originalId);
            const userId = 'test-user-123';

            mockRepository.getApplicationHistories.mockResolvedValueOnce([]);

            const event = createTestEvent(encodedId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            // デコードされたIDでリポジトリが呼ばれることを確認
            expect(mockRepository.getApplicationHistories).toHaveBeenCalledWith(
                userId,
                originalId
            );
        });
    });

    describe('異常系テスト', () => {
        it('should return 401 for missing user authentication', async () => {
            // Arrange
            const event = createTestEvent('test-app-id');
            event.requestContext.authorizer = null; // 認証情報なし

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('User authentication required');
        });

        it('should return 400 for missing application ID', async () => {
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

        it('should return 400 for empty application ID', async () => {
            // Arrange
            const event = createTestEvent('');
            event.pathParameters = { id: '' }; // 空のID

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Application ID is required');
        });

        it('should return 500 for repository errors', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#ErrorEA';
            const userId = 'test-user-123';

            mockRepository.getApplicationHistories.mockRejectedValueOnce(
                new Error('DynamoDB connection failed')
            );

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain('Failed to retrieve application histories');
        });
    });

    describe('データ形式テスト', () => {
        it('should return correctly formatted response structure', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const mockHistories: EAApplicationHistory[] = [
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:30:00Z',
                    action: 'Approve',
                    changedBy: 'admin-user',
                    changedAt: '2025-06-05T15:30:00Z',
                    previousStatus: 'Pending',
                    newStatus: 'Approve',
                    reason: 'Application approved after review'
                }
            ];

            mockRepository.getApplicationHistories.mockResolvedValueOnce(mockHistories);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);

            // レスポンス構造の確認
            expect(responseBody).toHaveProperty('success', true);
            expect(responseBody).toHaveProperty('message');
            expect(responseBody).toHaveProperty('data');
            expect(responseBody.data).toHaveProperty('id', applicationId);
            expect(responseBody.data).toHaveProperty('histories');

            // 履歴データの構造確認
            const history = responseBody.data.histories[0];
            expect(history).toHaveProperty('userId');
            expect(history).toHaveProperty('sk');
            expect(history).toHaveProperty('action');
            expect(history).toHaveProperty('changedBy');
            expect(history).toHaveProperty('changedAt');
            expect(history).toHaveProperty('previousStatus');
            expect(history).toHaveProperty('newStatus');
            expect(history).toHaveProperty('reason');
        });

        it('should handle various action types correctly', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const mockHistories: EAApplicationHistory[] = [
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:35:00Z',
                    action: 'Revoked',
                    changedBy: 'admin-user',
                    changedAt: '2025-06-05T15:35:00Z',
                    previousStatus: 'Active',
                    newStatus: 'Revoked',
                    reason: 'Security violation detected'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:30:00Z',
                    action: 'Active',
                    changedBy: 'system',
                    changedAt: '2025-06-05T15:30:00Z',
                    previousStatus: 'AwaitingNotification',
                    newStatus: 'Active',
                    reason: 'License activated successfully'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:25:00Z',
                    action: 'Cancelled',
                    changedBy: userId,
                    changedAt: '2025-06-05T15:25:00Z',
                    previousStatus: 'AwaitingNotification',
                    newStatus: 'Cancelled',
                    reason: 'Cancelled by user within 180 seconds of approval'
                }
            ];

            mockRepository.getApplicationHistories.mockResolvedValueOnce(mockHistories);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.histories).toHaveLength(3);

            // 各アクションタイプの確認
            const actions = responseBody.data.histories.map((h: any) => h.action);
            expect(actions).toContain('Revoked');
            expect(actions).toContain('Active');
            expect(actions).toContain('Cancelled');
        });
    });

    describe('時系列順序テスト', () => {
        it('should return histories in reverse chronological order (newest first)', async () => {
            // Arrange
            const applicationId = '2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const mockHistories: EAApplicationHistory[] = [
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:30:00Z',
                    action: 'Active',
                    changedBy: 'system',
                    changedAt: '2025-06-05T15:30:00Z',
                    previousStatus: 'AwaitingNotification',
                    newStatus: 'Active'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:25:00Z',
                    action: 'AwaitingNotification',
                    changedBy: 'admin-user',
                    changedAt: '2025-06-05T15:25:00Z',
                    previousStatus: 'Pending',
                    newStatus: 'AwaitingNotification'
                },
                {
                    userId,
                    sk: 'HISTORY#2025-01-01T00:00:00Z#TestBroker#123456#TestEA#2025-06-05T15:20:00Z',
                    action: 'Created',
                    changedBy: userId,
                    changedAt: '2025-06-05T15:20:00Z',
                    newStatus: 'Pending'
                }
            ];

            mockRepository.getApplicationHistories.mockResolvedValueOnce(mockHistories);

            const event = createTestEvent(applicationId, userId);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            const histories = responseBody.data.histories;

            // 時系列順序の確認（新しい順）
            expect(histories[0].changedAt).toBe('2025-06-05T15:30:00Z');
            expect(histories[1].changedAt).toBe('2025-06-05T15:25:00Z');
            expect(histories[2].changedAt).toBe('2025-06-05T15:20:00Z');
        });
    });
});