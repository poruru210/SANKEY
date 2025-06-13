import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/integration/startIntegrationTest.handler';
import type { StartIntegrationTestHandlerDependencies } from '../../../src/di/types';

// グローバルfetchのモック
global.fetch = vi.fn();

describe('startIntegrationTest.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockIntegrationTestService: any;
    let mockLogger: any;
    let mockTracer: any;
    let mockEvent: APIGatewayProxyEvent;
    let mockContext: Context;
    let dependencies: StartIntegrationTestHandlerDependencies;
    let handler: any;

    beforeEach(() => {
        vi.clearAllMocks();

        (global.fetch as MockedFunction<typeof fetch>).mockReset();

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockIntegrationTestService = container.resolve('integrationTestService');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            integrationTestService: mockIntegrationTestService,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);

        mockEvent = {
            body: JSON.stringify({
                gasWebappUrl: 'https://script.google.com/macros/s/test-deployment-id/exec'
            }),
            headers: {},
            multiValueHeaders: {},
            httpMethod: 'POST',
            isBase64Encoded: false,
            path: '/integration-test/start',
            pathParameters: null,
            queryStringParameters: null,
            multiValueQueryStringParameters: null,
            stageVariables: null,
            resource: '/integration-test/start',
            requestContext: {
                accountId: '123456789012',
                apiId: 'test-api-id',
                authorizer: {
                    claims: {
                        sub: 'test-user-123'
                    }
                },
                protocol: 'HTTP/1.1',
                httpMethod: 'POST',
                path: '/integration-test/start',
                stage: 'test',
                requestId: 'test-request-id',
                requestTime: '01/Jan/2025:00:00:00 +0000',
                requestTimeEpoch: 1735689600000,
                resourceId: 'test-resource-id',
                resourcePath: '/integration-test/start',
                identity: {
                    cognitoIdentityPoolId: null,
                    accountId: null,
                    cognitoIdentityId: null,
                    caller: null,
                    sourceIp: '127.0.0.1',
                    principalOrgId: null,
                    accessKey: null,
                    cognitoAuthenticationType: null,
                    cognitoAuthenticationProvider: null,
                    userArn: null,
                    userAgent: 'test-user-agent',
                    user: null,
                    apiKey: null,
                    apiKeyId: null,
                    clientCert: null
                }
            }
        };

        mockContext = {
            callbackWaitsForEmptyEventLoop: false,
            functionName: 'start-integration-test',
            functionVersion: '$LATEST',
            invokedFunctionArn: 'arn:aws:lambda:ap-northeast-1:123456789012:function:start-integration-test',
            memoryLimitInMB: '128',
            awsRequestId: 'test-request-id',
            logGroupName: '/aws/lambda/start-integration-test',
            logStreamName: '2025/01/01/[$LATEST]test',
            getRemainingTimeInMillis: () => 300000,
            done: () => {},
            fail: () => {},
            succeed: () => {}
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('正常系', () => {
        it('統合テストを正常に開始する', async () => {
            const mockGasResponse = {
                success: true,
                message: 'Integration test initiated'
            };

            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 0
            });

            mockIntegrationTestService.startIntegrationTest.mockResolvedValue(undefined);
            mockIntegrationTestService.recordTestStarted.mockResolvedValue(undefined);

            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue(JSON.stringify(mockGasResponse)),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Integration test started successfully');
            expect(body.data.testId).toMatch(/^INTEGRATION_\d+_[a-z0-9]+$/);
            expect(mockIntegrationTestService.startIntegrationTest).toHaveBeenCalled();
            expect(mockIntegrationTestService.recordTestStarted).toHaveBeenCalled();
        });

        it('失敗したテストのリトライを処理する', async () => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 25,
                test: {
                    testId: 'OLD_TEST_123',
                    gasWebappUrl: 'https://old-url.com',
                    currentStep: 'STARTED',
                    currentStepStatus: 'failed'
                }
            });

            mockIntegrationTestService.cleanupIntegrationTestData.mockResolvedValue(undefined);
            mockIntegrationTestService.startIntegrationTest.mockResolvedValue(undefined);
            mockIntegrationTestService.recordTestStarted.mockResolvedValue(undefined);

            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(200);
            expect(mockIntegrationTestService.cleanupIntegrationTestData).toHaveBeenCalledWith('test-user-123');
        });
    });

    describe('異常系 - 認証', () => {
        it('認証コンテキストにuserIdがない場合は401を返す', async () => {
            mockEvent.requestContext.authorizer = {};

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('User ID not found in authorization context');
        });
    });

    describe('異常系 - リクエスト検証', () => {
        it('リクエストボディがない場合は400を返す', async () => {
            mockEvent.body = null;

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toContain('gasWebappUrl is required and must be a string');
        });

        it('リクエストボディが無効なJSONの場合は400を返す', async () => {
            mockEvent.body = 'invalid-json';

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Invalid JSON in request body');
        });

        it('gasWebappUrlがない場合は400を返す', async () => {
            mockEvent.body = JSON.stringify({});

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('gasWebappUrl is required and must be a string');
        });

        it('gasWebappUrlが文字列でない場合は400を返す', async () => {
            mockEvent.body = JSON.stringify({
                gasWebappUrl: 12345
            });

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('gasWebappUrl is required and must be a string');
        });

        it('gasWebappUrlが有効なURLでない場合は400を返す', async () => {
            mockEvent.body = JSON.stringify({
                gasWebappUrl: 'not-a-valid-url'
            });

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('gasWebappUrl must be a valid URL');
        });
    });

    describe('異常系 - テスト状態', () => {
        it('統合テストが既に進行中の場合は400を返す', async () => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: true,
                canRetry: false,
                progress: 50,
                test: {
                    currentStep: 'GAS_WEBHOOK_RECEIVED',
                    currentStepStatus: 'success'
                }
            });

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('An integration test is already in progress');
        });
    });

    describe('異常系 - GAS呼び出し', () => {
        beforeEach(() => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 0
            });
            mockIntegrationTestService.startIntegrationTest.mockResolvedValue(undefined);
            mockIntegrationTestService.recordProgress.mockResolvedValue(undefined);
        });

        it('GAS WebAppがエラーレスポンスを返した場合は500を返す', async () => {
            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: vi.fn().mockResolvedValue('Server error'),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to trigger integration test');
        });

        it('GAS WebAppが無効なJSONを返した場合は500を返す', async () => {
            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue('not json'),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to trigger integration test');
        });

        it('GAS WebApp呼び出しが例外をスローした場合は500を返す', async () => {
            (global.fetch as MockedFunction<typeof fetch>).mockRejectedValueOnce(
                new Error('Network error')
            );

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to trigger integration test');
        });

        it('GAS WebAppがsuccess: falseを返した場合は500を返す', async () => {
            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue(JSON.stringify({
                    success: false,
                    error: 'GAS script execution failed'
                })),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to trigger integration test');
        });
    });

    describe('異常系 - 予期しないエラー', () => {
        it('予期しないエラーが発生した場合は500を返す', async () => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 0
            });
            mockIntegrationTestService.startIntegrationTest.mockRejectedValue(
                new Error('Database connection failed')
            );

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('An unexpected error occurred');
        });
    });

    describe('エッジケース', () => {
        it('GAS WebAppから空のレスポンスを処理する', async () => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 0
            });

            mockIntegrationTestService.startIntegrationTest.mockResolvedValue(undefined);
            mockIntegrationTestService.recordProgress.mockResolvedValue(undefined);

            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue(''),
            } as any);

            const result = await handler(mockEvent, mockContext);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to trigger integration test');
        });

        it('一意のテストIDを生成する', async () => {
            mockIntegrationTestService.getIntegrationTestStatus.mockResolvedValue({
                active: false,
                canRetry: true,
                progress: 0
            });

            mockIntegrationTestService.startIntegrationTest.mockResolvedValue(undefined);
            mockIntegrationTestService.recordTestStarted.mockResolvedValue(undefined);

            (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
            } as any);

            const result1 = await handler(mockEvent, mockContext);
            const result2 = await handler(mockEvent, mockContext);

            const body1 = JSON.parse(result1.body);
            const body2 = JSON.parse(result2.body);
            expect(body1.data.testId).not.toBe(body2.data.testId);
        });
    });
});