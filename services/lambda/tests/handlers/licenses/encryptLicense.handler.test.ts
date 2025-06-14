import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/licenses/encryptLicense.handler';
import { DIContainer, EncryptLicenseHandlerDependencies } from '../../../src/di/dependencies';
import { encryptLicense } from '../../../src/services/encryption';
import { createLicensePayloadV1 } from '../../../src/models/licensePayload';

// encryptLicense関数のモック
vi.mock('../../../src/services/encryption', () => ({
    encryptLicense: vi.fn()
}));

// createLicensePayloadV1関数のモック
vi.mock('../../../src/models/licensePayload', async () => {
    const actual = await vi.importActual('../../../src/models/licensePayload');
    return {
        ...actual,
        createLicensePayloadV1: vi.fn((params) => ({
            version: 1,
            ...params
        }))
    };
});

describe('encryptLicense.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockMasterKeyService: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: EncryptLicenseHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-13T00:00:00Z'));

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockMasterKeyService = container.resolve('masterKeyService');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            masterKeyService: mockMasterKeyService,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
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
        path: '/licenses/encrypt',
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        resource: '/licenses/encrypt',
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
            path: '/licenses/encrypt',
            stage: 'test',
            requestId: 'test-request-id',
            requestTimeEpoch: 1234567890,
            resourceId: 'resource-id',
            resourcePath: '/licenses/encrypt',
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

    describe('認証チェック', () => {
        it('認証情報がない場合は401エラーを返す', async () => {
            const event = createTestEvent({
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('User authentication required');
        });
    });

    describe('リクエストバリデーション', () => {
        const userId = 'test-user-id';

        it('リクエストボディがない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: null
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Request body is required');
        });

        it('JSONが不正な場合は400エラーを返す', async () => {
            const event = createTestEvent({ userId });
            event.body = 'invalid json';

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Invalid JSON format in request body');
        });

        it('eaNameが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    accountId: 'ACC123',
                    expiry: '2025-12-31'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('eaName is required and must be a string');
        });

        it('accountIdが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    expiry: '2025-12-31'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('accountId is required and must be a string');
        });

        it('expiryが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('expiry is required and must be an ISO date string');
        });

        it('expiryが無効な日付形式の場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: 'invalid-date'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('expiry must be a valid ISO date string');
        });

        it('expiryが過去の日付の場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2024-12-31'  // 過去の日付
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('expiry must be in the future');
        });

        it('issuedAtが無効な日付形式の場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31',
                    issuedAt: 'invalid-date'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('issuedAt must be a valid ISO date string');
        });

        it('サポートされていないバージョンの場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31',
                    version: '2'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Unsupported payload version: 2. Supported versions: 1');
        });
    });

    describe('正常な暗号化処理', () => {
        const userId = 'test-user-id';
        const mockCryptoKey = {} as CryptoKey;
        const mockEncryptedLicense = 'encrypted-license-string';

        it('必須フィールドのみで正常にライセンスを暗号化できる', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31'
                }
            });

            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValueOnce(mockCryptoKey);
            (encryptLicense as any).mockResolvedValueOnce(mockEncryptedLicense);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('License encrypted successfully');
            expect(body.data.encryptedLicense).toBe(mockEncryptedLicense);
            expect(body.data.payload).toEqual({
                version: 1,
                eaName: 'Test EA',
                accountId: 'ACC123',
                expiry: '2025-12-31',
                userId: userId,
                issuedAt: '2025-06-13T00:00:00.000Z'
            });

            expect(mockMasterKeyService.getUserMasterKeyForEncryption).toHaveBeenCalledWith(userId);
            expect(createLicensePayloadV1).toHaveBeenCalledWith({
                eaName: 'Test EA',
                accountId: 'ACC123',
                expiry: '2025-12-31',
                userId: userId,
                issuedAt: '2025-06-13T00:00:00.000Z'
            });
            expect(encryptLicense).toHaveBeenCalledWith(mockCryptoKey, expect.any(Object), 'ACC123');
        });

        it('すべてのフィールドを指定して正常にライセンスを暗号化できる', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31',
                    issuedAt: '2025-01-01',
                    version: 1  // 文字列ではなく数値として送る
                }
            });

            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValueOnce(mockCryptoKey);
            (encryptLicense as any).mockResolvedValueOnce(mockEncryptedLicense);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.data.payload.issuedAt).toBe('2025-01-01');
            expect(body.data.payload.version).toBe(1);
        })
    });

    describe('エラーハンドリング', () => {
        const userId = 'test-user-id';

        it('マスターキーの取得に失敗した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31'
                }
            });

            mockMasterKeyService.getUserMasterKeyForEncryption.mockRejectedValueOnce(new Error('Key not found'));

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to encrypt license');
            expect(body.data?.error).toBe('Key not found');
        });

        it('暗号化に失敗した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    eaName: 'Test EA',
                    accountId: 'ACC123',
                    expiry: '2025-12-31'
                }
            });

            const mockCryptoKey = {} as CryptoKey;
            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValueOnce(mockCryptoKey);
            (encryptLicense as any).mockRejectedValueOnce(new Error('Encryption failed'));

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to encrypt license');
            expect(body.data?.error).toBe('Encryption failed');
        });
    });
});