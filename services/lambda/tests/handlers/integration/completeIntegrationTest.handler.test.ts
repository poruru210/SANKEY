import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/integration/completeIntegrationTest.handler';
import type { DIContainer, CompleteIntegrationTestHandlerDependencies } from '../../../src/di/dependencies';

describe('completeIntegrationTest.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockJWTKeyService: any;
    let mockIntegrationTestService: any;
    let mockDocClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: CompleteIntegrationTestHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // 環境変数の設定
        process.env.USER_PROFILE_TABLE_NAME = 'test-user-profile-table';

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockJWTKeyService = container.resolve('jwtKeyService');
        mockIntegrationTestService = container.resolve('integrationTestService');
        mockDocClient = container.resolve('docClient');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            jwtKeyService: mockJWTKeyService,
            integrationTestService: mockIntegrationTestService,
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
        userId?: string;
    }): APIGatewayProxyEvent => ({
        body: params.body ? JSON.stringify(params.body) : null,
        headers: {},
        multiValueHeaders: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/integration/complete',
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        resource: '/integration/complete',
        requestContext: {
            accountId: '123456789012',
            apiId: 'api-id',
            authorizer: params.userId ? {
                claims: {
                    sub: params.userId
                }
            } : undefined,
            protocol: 'HTTP/1.1',
            httpMethod: 'POST',
            path: '/integration/complete',
            stage: 'test',
            requestId: 'test-request-id',
            requestTimeEpoch: 1234567890,
            resourceId: 'resource-id',
            resourcePath: '/integration/complete',
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
            const event = createTestEvent({
                userId: 'test-user-id'
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Request body is required');
        });

        it('JWTアクセスが無効な場合は401エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
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
            expect(body.message).toBe('Authentication failed');
        });

        it('ユーザープロファイルが見つからない場合は404エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            const mockSend = vi.fn().mockResolvedValueOnce({ Item: null });
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(404);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('User profile not found');
        });

        it('テストIDが一致しない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'wrong-test-id',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            const mockUserProfile = {
                userId: 'test-user-id',
                setupPhase: 'TEST',
                testResults: {
                    integration: {
                        testId: 'correct-test-id'
                    }
                }
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: mockUserProfile }); // GetCommand
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Test ID mismatch');
        });
    });

    describe('正常な完了処理', () => {
        const mockUserProfile = {
            userId: 'test-user-id',
            setupPhase: 'TEST',
            testResults: {
                integration: {
                    testId: 'test-id-123'
                }
            },
            updatedAt: '2025-06-13T00:00:00Z'
        };

        it('テスト成功時にプロファイルを更新してPRODUCTIONフェーズに移行する', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z',
                        details: 'Test completed successfully'
                    }
                }
            });

            const updatedProfile = {
                ...mockUserProfile,
                setupPhase: 'PRODUCTION',
                testResults: {
                    ...mockUserProfile.testResults,
                    setup: { success: true }
                }
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            mockIntegrationTestService.recordProgress.mockResolvedValueOnce(undefined);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: mockUserProfile }) // GetCommand
                .mockResolvedValueOnce({ Attributes: updatedProfile }); // UpdateCommand
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Integration test completed');
            expect(body.data.setupPhase).toBe('PRODUCTION');
            expect(body.data.phaseTransitioned).toBe(true);
            expect(body.data.testSuccess).toBe(true);
            expect(body.data.message).toBe('Test completed successfully. System is now in PRODUCTION mode.');

            expect(mockIntegrationTestService.recordProgress).toHaveBeenCalledWith(
                'test-user-id',
                'COMPLETED',
                true,
                { licenseId: 'license-id-123', applicationSK: 'app-id-123' }
            );
        });

        it('テスト失敗時はTESTフェーズのままにする', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: false,
                        timestamp: '2025-06-13T00:00:00Z',
                        error: 'Connection failed'
                    }
                }
            });

            const updatedProfile = {
                ...mockUserProfile,
                setupPhase: 'TEST' // フェーズは変わらない
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            mockIntegrationTestService.recordProgress.mockResolvedValueOnce(undefined);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: mockUserProfile }) // GetCommand
                .mockResolvedValueOnce({ Attributes: updatedProfile }); // UpdateCommand
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Integration test completed');
            expect(body.data.setupPhase).toBe('TEST');
            expect(body.data.phaseTransitioned).toBe(false);
            expect(body.data.testSuccess).toBe(false);
            expect(body.data.message).toBe('Test completed with errors.');

            expect(mockIntegrationTestService.recordProgress).toHaveBeenCalledWith(
                'test-user-id',
                'COMPLETED',
                false,
                { licenseId: 'license-id-123', applicationSK: 'app-id-123' }
            );
        });

        it('すでにPRODUCTIONフェーズの場合はフェーズ移行なしで成功を返す', async () => {
            const productionUserProfile = {
                ...mockUserProfile,
                setupPhase: 'PRODUCTION'
            };

            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            const updatedProfile = {
                ...productionUserProfile,
                setupPhase: 'PRODUCTION',
                testResults: {
                    ...productionUserProfile.testResults,
                    setup: { success: true }
                }
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            mockIntegrationTestService.recordProgress.mockResolvedValueOnce(undefined);

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: productionUserProfile }) // GetCommand
                .mockResolvedValueOnce({ Attributes: updatedProfile }); // UpdateCommand
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.data.phaseTransitioned).toBe(false);
            expect(body.data.message).toBe('Test completed successfully.');
        });
    });

    describe('エラーハンドリング', () => {
        it('DynamoDBアクセスでエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
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
            expect(body.message).toBe('Failed to complete test');
            expect(body.data?.error).toBe('DynamoDB Error');
        });

        it('統合テストサービスでエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    userId: 'test-user-id',
                    testId: 'test-id-123',
                    licenseId: 'license-id-123',
                    applicationId: 'app-id-123',
                    testResult: {
                        success: true,
                        timestamp: '2025-06-13T00:00:00Z'
                    }
                }
            });

            const mockUserProfile = {
                userId: 'test-user-id',
                setupPhase: 'TEST',
                testResults: {
                    integration: {
                        testId: 'test-id-123'
                    }
                }
            };

            mockJWTKeyService.validateJwtAccess.mockResolvedValueOnce(true);
            mockIntegrationTestService.recordProgress.mockRejectedValueOnce(new Error('Service Error'));

            const mockSend = vi.fn()
                .mockResolvedValueOnce({ Item: mockUserProfile }); // GetCommand
            (mockDocClient.send as any) = mockSend;

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to complete test');
            expect(body.data?.error).toBe('Service Error');
        });
    });
});