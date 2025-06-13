import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/licenses/decryptLicense.handler';
import type { DecryptLicenseHandlerDependencies } from '../../../src/di/types';
import { LicensePayloadV1 } from '../../../src/models/licensePayload';

// decryptLicense関数のモック
vi.mock('../../../src/services/encryption', () => ({
    decryptLicense: vi.fn()
}));

import { decryptLicense } from '../../../src/services/encryption';

describe('decryptLicense.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockMasterKeyService: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: DecryptLicenseHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockMasterKeyService = container.resolve('masterKeyService');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEAApplicationRepository,
            masterKeyService: mockMasterKeyService,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ヘルパー関数: テスト用のAPIイベント作成
    const createTestEvent = (params: {
        pathParameters?: Record<string, string>;
        body?: any;
        userId?: string;
    }): APIGatewayProxyEvent => ({
        body: params.body ? JSON.stringify(params.body) : null,
        headers: {},
        multiValueHeaders: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/licenses/decrypt',
        pathParameters: params.pathParameters || null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        resource: '/licenses/decrypt',
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
            path: '/licenses/decrypt',
            stage: 'test',
            requestId: 'test-request-id',
            requestTimeEpoch: 1234567890,
            resourceId: 'resource-id',
            resourcePath: '/licenses/decrypt',
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
                pathParameters: { id: 'test-app-id' }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('User authentication required');
            expect(body.timestamp).toBeDefined();
        });
    });

    describe('アプリケーションIDベースの復号化（パスパラメータあり）', () => {
        const userId = 'test-user-id';
        const applicationId = 'test-app-id';
        const mockCryptoKey = {} as CryptoKey;
        const mockApplication = {
            userId,
            sk: `APPLICATION#${applicationId}`,
            accountNumber: 'ACC123',
            licenseKey: 'encrypted-license-key',
            status: 'Active',
            eaName: 'Test EA',
            broker: 'Test Broker'  // アプリケーションにはbrokerがある
        };
        const mockDecryptedPayload: LicensePayloadV1 = {
            version: 1,
            userId,
            accountId: 'ACC123',
            eaName: 'Test EA',
            expiry: '2025-12-31',
            issuedAt: '2025-01-01'
            // brokerはライセンスペイロードには含まれない
        };

        it('正常にライセンスを復号化できる', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockMasterKeyService.getUserMasterKeyForDecryption.mockResolvedValueOnce(mockCryptoKey);
            (decryptLicense as any).mockResolvedValueOnce(mockDecryptedPayload);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('License decrypted successfully');
            expect(body.data.decryptedLicense).toEqual(mockDecryptedPayload);

            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, `APPLICATION#${applicationId}`);
            expect(mockMasterKeyService.getUserMasterKeyForDecryption).toHaveBeenCalledWith(userId);
            expect(decryptLicense).toHaveBeenCalledWith(mockCryptoKey, 'encrypted-license-key', 'ACC123');
        });

        it('APPLICATION#プレフィックスがすでに付いている場合も正常に処理できる', async () => {
            const event = createTestEvent({
                pathParameters: { id: `APPLICATION#${applicationId}` },
                userId
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockMasterKeyService.getUserMasterKeyForDecryption.mockResolvedValueOnce(mockCryptoKey);
            (decryptLicense as any).mockResolvedValueOnce(mockDecryptedPayload);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, `APPLICATION#${applicationId}`);
        });

        it('アプリケーションが見つからない場合は404エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(null);

            const result = await handler(event);

            expect(result.statusCode).toBe(404);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Application not found');
        });

        it('アカウント番号がない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            const appWithoutAccount = { ...mockApplication, accountNumber: undefined };
            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(appWithoutAccount);

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Account number not found in application');
        });

        it('ライセンスキーがない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            const appWithoutLicense = { ...mockApplication, licenseKey: undefined };
            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(appWithoutLicense);

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('License key not found in application');
        });

        it('復号化に失敗した場合は400エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockMasterKeyService.getUserMasterKeyForDecryption.mockResolvedValueOnce(mockCryptoKey);
            (decryptLicense as any).mockRejectedValueOnce(new Error('Decryption failed'));

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to decrypt license - invalid license key or data corruption');
        });

        it('リポジトリアクセスでエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });

            mockEAApplicationRepository.getApplication.mockRejectedValueOnce(new Error('DB Error'));

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to decrypt license');
            expect(body.data?.error).toBe('DB Error');
        });
    });

    describe('直接復号化（パスパラメータなし）', () => {
        const userId = 'test-user-id';
        const mockCryptoKey = {} as CryptoKey;
        const mockDecryptedPayload: LicensePayloadV1 = {
            version: 1,
            userId,
            accountId: 'ACC123',
            eaName: 'Test EA',
            expiry: '2025-12-31',
            issuedAt: '2025-01-01'
        };

        it('正常にライセンスを復号化できる', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    encryptedLicense: 'encrypted-license-string',
                    accountId: 'ACC123'
                }
            });

            mockMasterKeyService.getUserMasterKeyForDecryption.mockResolvedValueOnce(mockCryptoKey);
            (decryptLicense as any).mockResolvedValueOnce(mockDecryptedPayload);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('License decrypted successfully');
            expect(body.data.decryptedLicense).toEqual(mockDecryptedPayload);

            expect(mockMasterKeyService.getUserMasterKeyForDecryption).toHaveBeenCalledWith(userId);
            expect(decryptLicense).toHaveBeenCalledWith(mockCryptoKey, 'encrypted-license-string', 'ACC123');
        });

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
            const event = createTestEvent({
                userId
            });
            event.body = 'invalid json';

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Invalid JSON in request body');
        });

        it('encryptedLicenseが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    accountId: 'ACC123'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('encryptedLicense is required');
        });

        it('accountIdが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    encryptedLicense: 'encrypted-license-string'
                }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('accountId is required');
        });

        it('復号化に失敗した場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    encryptedLicense: 'encrypted-license-string',
                    accountId: 'ACC123'
                }
            });

            mockMasterKeyService.getUserMasterKeyForDecryption.mockResolvedValueOnce(mockCryptoKey);
            (decryptLicense as any).mockRejectedValueOnce(new Error('Invalid license'));

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to decrypt license - invalid license key or data corruption');
        });

        it('マスターキーの取得に失敗した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                userId,
                body: {
                    encryptedLicense: 'encrypted-license-string',
                    accountId: 'ACC123'
                }
            });

            mockMasterKeyService.getUserMasterKeyForDecryption.mockRejectedValueOnce(new Error('Key not found'));

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to decrypt license');
            expect(body.data?.error).toBe('Key not found');
        });
    });
});