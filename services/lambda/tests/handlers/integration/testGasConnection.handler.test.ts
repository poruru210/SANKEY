import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/integration/testGasConnection.handler';
import type { TestGasConnectionHandlerDependencies } from '../../../src/di/types';

describe('testGasConnection.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockJWTKeyService: any;
    let mockDocClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: TestGasConnectionHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // 環境変数の設定
        process.env.USER_PROFILE_TABLE_NAME = 'test-user-profile-table';

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockJWTKeyService = container.resolve('jwtKeyService');
        mockDocClient = container.resolve('docClient');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            jwtKeyService: mockJWTKeyService,
            docClient: mockDocClient,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.USER_PROFILE_TABLE_NAME;
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (params: {
        body?: any;
        headers?: Record<string, string>;
    }): APIGatewayProxyEvent => ({
        body: params.body ? JSON.stringify(params.body) : null,
        headers: params.headers || {},
        multiValueHeaders: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/integration/test-gas-connection',
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        resource: '/integration/test-gas-connection',
        requestContext: {
            accountId: '123456789012',
            apiId: 'api-id',
            authorizer: undefined,
            protocol: 'HTTP/1.1',
            httpMethod: 'POST',
            path: '/integration/test-gas-connection',
            stage: 'test',
            requestId: 'test-request-id',
            requestTimeEpoch: 1234567890,
            resourceId: 'resource-id',
            resourcePath: '/integration/test-gas-connection',
            identity: {
                cognitoIdentityPoolId: null,
                accountId: null,
                cognitoIdentityId: null,
                caller: null,
                apiKey: null,
                sourceIp: '127.0.0.1',
                cognitoAuthenticationType: null,
                cognitoAuthenticationProvider: null,
                userArn: null,
                userAgent: 'test-agent',
                user: null,
                accessKey: null,
                apiKeyId: null,
                clientCert: null,
                principalOrgId: null
            }
        }
    });

    describe('バリデーション', () => {
        it('リクエストボディがない場合は400エラーを返す', async () => {
            const event = createTestEvent({});

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Request body is required');
        });

        it('JSONが不正な場合は400エラーを返す', async () => {
            const event = createTestEvent({});
            event.body = 'invalid json';

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Invalid JSON in request body');
        });

        it('必須パラメータが不足している場合は400エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id'
                    // testResultが不足
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Missing required parameters: userId, testResult');
        });

        it('testResultの形式が不正な場合は400エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: 'not-boolean', // booleanでない
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Invalid testResult format. Required: success (boolean), timestamp (string)');
        });
    });

    describe('認証', () => {
        it('JWTアクセスが無効な場合は401エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(false);

            const result = await handler(event);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Authentication failed: Invalid user or JWT secret not found');
        });

        it('JWT検証でエラーが発生した場合は401エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            mockJWTKeyService.validateJwtAccess.mockRejectedValueOnce(new Error('JWT Error'));

            const result = await handler(event);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Authentication failed');
        });
    });

    describe('正常なテスト結果処理', () => {
        it('テスト成功時に新規プロファイルを作成してTESTフェーズに移行する', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z',
                        details: 'GAS connection successful',
                        gasProjectId: 'gas-project-123'
                    }
                },
                headers: {
                    'user-agent': 'Mozilla/5.0',
                    'referer': 'https://example.com'
                }
            });

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // GetCommand - プロファイルなし
                .mockResolvedValueOnce({}) // PutCommand - 新規作成
                .mockResolvedValueOnce({ // UpdateCommand
                    Attributes: {
                        userId: 'test-user-id',
                        setupPhase: 'TEST',
                        testResults: {
                            setupTest: {
                                success: true,
                                timestamp: '2025-06-13T00:00:00Z',
                                details: 'GAS connection test completed successfully'
                            }
                        },
                        setupData: {
                            gasProjectId: 'gas-project-123'
                        }
                    }
                });
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('GAS connection test result recorded successfully');
            expect(body.data.setupPhase).toBe('TEST');
            expect(body.data.testResult.success).toBe(true);
            expect(body.data.nextStep).toBe('Ready for integration test');

            // ログ出力の確認
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Request headers analysis',
                expect.objectContaining({
                    userAgent: 'Mozilla/5.0',
                    referer: 'https://example.com'
                })
            );
        });

        it('既存プロファイルがある場合は更新する', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            const existingProfile = {
                userId: 'test-user-id',
                setupPhase: 'SETUP',
                testResults: {},
                setupData: {}
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: existingProfile }) // GetCommand
                .mockResolvedValueOnce({ // UpdateCommand
                    Attributes: {
                        userId: 'test-user-id',
                        setupPhase: 'TEST',
                        testResults: {
                            setupTest: {
                                success: true,
                                timestamp: '2025-06-13T00:00:00Z',
                                details: 'GAS connection test completed successfully'
                            }
                        },
                        setupData: {}
                    }
                });
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.data.setupPhase).toBe('TEST');
        });

        it('テスト失敗時はフェーズを変更せずに結果を記録する', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: false,
                        timestamp: '2025-06-13T00:00:00Z',
                        details: 'Connection failed'
                    }
                }
            });

            const existingProfile = {
                userId: 'test-user-id',
                setupPhase: 'SETUP',
                testResults: {},
                setupData: {}
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: existingProfile }) // GetCommand
                .mockResolvedValueOnce({ // UpdateCommand
                    Attributes: {
                        userId: 'test-user-id',
                        setupPhase: 'SETUP', // フェーズは変わらない
                        testResults: {
                            setupTest: {
                                success: false,
                                timestamp: '2025-06-13T00:00:00Z',
                                details: 'Connection failed'
                            }
                        },
                        setupData: {}
                    }
                });
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('GAS connection test failure recorded');
            expect(body.data.setupPhase).toBe('SETUP');
            expect(body.data.testResult.success).toBe(false);
            expect(body.data.nextStep).toBe('Please check GAS configuration and retry the test');
        });
    });

    describe('エラーハンドリング', () => {
        it('プロファイル取得でエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);

            const mockSend = vi.fn().mockRejectedValueOnce(new Error('DynamoDB Error'));
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to process GAS connection test');
            expect(body.data?.error).toBe('DynamoDB Error');
        });

        it('プロファイル作成でエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: null }) // GetCommand
                .mockRejectedValueOnce(new Error('Create Error')); // PutCommand失敗
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to process GAS connection test');
        });
    });
});