import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/applications/webhook.handler';
import type { DIContainer, WebhookHandlerDependencies } from '../../../src/di/dependencies';
import type { EAApplication } from '../../../src/models/eaApplication';

describe('webhook.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockJWTKeyService: any;
    let mockIntegrationTestService: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: WebhookHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockJWTKeyService = container.resolve('jwtKeyService');
        mockIntegrationTestService = container.resolve('integrationTestService');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEAApplicationRepository,
            jwtKeyService: mockJWTKeyService,
            integrationTestService: mockIntegrationTestService,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (requestBody: any): APIGatewayProxyEvent => ({
        httpMethod: 'POST',
        path: '/webhook',
        pathParameters: null,
        body: JSON.stringify(requestBody),
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        isBase64Encoded: false,
        requestContext: {} as any,
        resource: '',
        stageVariables: null
    });

    describe('正常系テスト', () => {
        it('有効なJWTトークンでアプリケーションを正常に作成する', async () => {
            // Arrange
            const userId = 'test-user-123';
            const jwtToken = 'valid.jwt.token';
            const jwtSecret = 'test-jwt-secret';

            const requestBody = {
                userId,
                data: jwtToken,
                method: 'JWT'
            };

            const decodedJwtData = {
                data: {
                    formData: {
                        eaName: 'TestEA',
                        broker: 'TestBroker',
                        accountNumber: '123456',
                        email: 'test@example.com',
                        xAccount: '@test'
                    }
                }
            };

            const mockApplication: EAApplication = {
                userId,
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // JWT サービスのモック
            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce(jwtSecret);
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);

            // リポジトリのモック
            mockEAApplicationRepository.createApplication.mockResolvedValueOnce(mockApplication);

            // 統合テストサービスのモック
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.message).toBe('Application submitted successfully');
            expect(responseBody.data.applicationId).toBe(mockApplication.sk);
            expect(responseBody.data.status).toBe('Pending');
            expect(responseBody.data.temporaryUrl).toContain(mockApplication.sk);

            // JWT サービスの呼び出し確認
            expect(mockJWTKeyService.getJwtSecret).toHaveBeenCalledWith(userId);
            expect(mockJWTKeyService.verifyJWT).toHaveBeenCalledWith(jwtToken, jwtSecret);

            // リポジトリの呼び出し確認
            expect(mockEAApplicationRepository.createApplication).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId,
                    eaName: 'TestEA',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com',
                    xAccount: '@test',
                    appliedAt: expect.any(String)
                })
            );
        });

        it('統合テストアプリケーションの場合、進捗を記録する', async () => {
            // Arrange
            const userId = 'test-user-123';
            const jwtToken = 'valid.jwt.token';
            const jwtSecret = 'test-jwt-secret';
            const integrationTestId = 'test-id-123';

            const requestBody = {
                userId,
                data: jwtToken
            };

            const decodedJwtData = {
                data: {
                    eaName: 'IntegrationTest',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com',
                    integrationTestId
                }
            };

            const mockApplication: EAApplication = {
                userId,
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#IntegrationTest',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'IntegrationTest',
                email: 'test@example.com',
                xAccount: '',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                integrationTestId
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce(jwtSecret);
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);
            mockEAApplicationRepository.createApplication.mockResolvedValueOnce(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(true);
            mockIntegrationTestService.recordProgress.mockResolvedValueOnce(undefined);

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);

            const responseBody = JSON.parse(result.body);
            expect(responseBody.data.testId).toBe(integrationTestId);
            expect(responseBody.data.integrationType).toBe('test');

            // 統合テストの進捗記録確認
            expect(mockIntegrationTestService.recordProgress).toHaveBeenCalledWith(
                userId,
                'GAS_WEBHOOK_RECEIVED',
                true,
                { applicationSK: mockApplication.sk }
            );
        });

        it('JWTペイロードがdata.formDataではなくdataに直接含まれる場合も処理できる', async () => {
            // Arrange
            const userId = 'test-user-123';
            const jwtToken = 'valid.jwt.token';
            const jwtSecret = 'test-jwt-secret';

            const requestBody = {
                userId,
                data: jwtToken
            };

            const decodedJwtData = {
                data: {
                    eaName: 'TestEA',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com'
                }
            };

            const mockApplication: EAApplication = {
                userId,
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce(jwtSecret);
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);
            mockEAApplicationRepository.createApplication.mockResolvedValueOnce(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);
            expect(mockEAApplicationRepository.createApplication).toHaveBeenCalledWith(
                expect.objectContaining({
                    eaName: 'TestEA',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com'
                })
            );
        });
    });

    describe('異常系テスト', () => {
        it('無効なJSONの場合は400を返す', async () => {
            // Arrange
            const event = createTestEvent('');
            event.body = 'invalid json';

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Invalid JSON in request body');
        });

        it('必須フィールドが不足している場合は400を返す', async () => {
            // Arrange
            const testCases = [
                { body: {}, error: 'userId is required' }, // 空のオブジェクトは最初にuserIdチェックに引っかかる
                { body: { data: 'token' }, error: 'userId is required' },
                { body: { userId: 'user123' }, error: 'data (JWT token) is required' }
            ];

            for (const testCase of testCases) {
                const event = createTestEvent(testCase.body);

                // Act
                const result = await handler(event);

                // Assert
                expect(result.statusCode).toBe(400);
                const responseBody = JSON.parse(result.body);
                expect(responseBody.message).toBe(testCase.error);
            }
        });

        it('JWT secret が存在しない場合は401を返す', async () => {
            // Arrange
            const requestBody = {
                userId: 'test-user-123',
                data: 'invalid.jwt.token'
            };

            mockJWTKeyService.getJwtSecret.mockRejectedValueOnce(
                new Error('JWT secret not found')
            );

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Authentication failed: JWT secret not found');
        });

        it('無効なJWTトークンの場合は401を返す', async () => {
            // Arrange
            const requestBody = {
                userId: 'test-user-123',
                data: 'invalid.jwt.token'
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce('test-secret');
            mockJWTKeyService.verifyJWT.mockRejectedValueOnce(
                new Error('Invalid JWT signature')
            );

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Authentication failed: Invalid JWT token');
        });

        it('アプリケーションデータが不正な場合は401を返す', async () => {
            // Arrange
            const requestBody = {
                userId: 'test-user-123',
                data: 'valid.jwt.token'
            };

            const incompleteJwtData = {
                data: {
                    formData: {
                        eaName: 'TestEA'
                        // broker, accountNumber, email が不足
                    }
                }
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce('test-secret');
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(incompleteJwtData);

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(401);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Missing required fields: broker, accountNumber, email');
        });

        it('アプリケーション作成に失敗した場合は500を返す', async () => {
            // Arrange
            const requestBody = {
                userId: 'test-user-123',
                data: 'valid.jwt.token'
            };

            const decodedJwtData = {
                data: {
                    eaName: 'TestEA',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com'
                }
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce('test-secret');
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);
            mockEAApplicationRepository.createApplication.mockRejectedValueOnce(
                new Error('Database error')
            );

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toBe('Failed to process webhook');
        });

        it('統合テストの進捗記録に失敗した場合は500を返す', async () => {
            // Arrange
            const userId = 'test-user-123';
            const integrationTestId = 'test-id-123';

            const requestBody = {
                userId,
                data: 'valid.jwt.token'
            };

            const decodedJwtData = {
                data: {
                    eaName: 'IntegrationTest',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com',
                    integrationTestId
                }
            };

            const mockApplication: EAApplication = {
                userId,
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#IntegrationTest',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'IntegrationTest',
                email: 'test@example.com',
                xAccount: '',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                integrationTestId
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce('test-secret');
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);
            mockEAApplicationRepository.createApplication.mockResolvedValueOnce(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(true);
            mockIntegrationTestService.recordProgress.mockRejectedValueOnce(
                new Error('Failed to record progress')
            );

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.message).toBe('Failed to process webhook');
        });
    });

    describe('method フィールドのテスト', () => {
        it('methodフィールドがない場合はデフォルトでJWTを使用する', async () => {
            // Arrange
            const requestBody = {
                userId: 'test-user-123',
                data: 'valid.jwt.token'
                // method フィールドなし
            };

            const decodedJwtData = {
                data: {
                    eaName: 'TestEA',
                    broker: 'TestBroker',
                    accountNumber: '123456',
                    email: 'test@example.com'
                }
            };

            const mockApplication: EAApplication = {
                userId: 'test-user-123',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockJWTKeyService.getJwtSecret.mockResolvedValueOnce('test-secret');
            mockJWTKeyService.verifyJWT.mockResolvedValueOnce(decodedJwtData);
            mockEAApplicationRepository.createApplication.mockResolvedValueOnce(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);

            const event = createTestEvent(requestBody);

            // Act
            const result = await handler(event);

            // Assert
            expect(result.statusCode).toBe(200);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Processing webhook for user',
                expect.objectContaining({
                    userId: 'test-user-123',
                    method: 'JWT'
                })
            );
        });
    });
});