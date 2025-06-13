import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/licenses/revokeLicense.handler';
import type { RevokeLicenseHandlerDependencies } from '../../../src/di/types';

describe('revokeLicense.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEAApplicationRepository: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: RevokeLicenseHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // テストコンテナから依存関係を取得（モックサービスを使用）
        container = createTestContainer({ useRealServices: false });
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEAApplicationRepository,
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
        userRole?: string;
    }): APIGatewayProxyEvent => ({
        body: params.body ? JSON.stringify(params.body) : null,
        headers: {},
        multiValueHeaders: {},
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/licenses/revoke',
        pathParameters: params.pathParameters || null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        resource: '/licenses/revoke/{id}',
        requestContext: {
            accountId: '123456789012',
            apiId: 'api-id',
            authorizer: params.userId ? {
                claims: {
                    sub: params.userId,
                    role: params.userRole || 'developer'
                }
            } : undefined,
            protocol: 'HTTP/1.1',
            httpMethod: 'POST',
            path: '/licenses/revoke',
            stage: 'test',
            requestId: 'test-request-id',
            requestTimeEpoch: 1234567890,
            resourceId: 'resource-id',
            resourcePath: '/licenses/revoke/{id}',
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
        it('アプリケーションIDが指定されていない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                userId: 'test-user-id'
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Application ID is required');
        });

        it('認証情報がない場合は401エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: 'test-app-id' }
            });

            const result = await handler(event);

            expect(result.statusCode).toBe(401);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Unauthorized');
        });
    });

    describe('正常な取り消し処理', () => {
        const userId = 'test-user-id';
        const applicationId = 'test-app-id';
        const mockApplication = {
            userId,
            sk: `APPLICATION#${applicationId}`,
            accountNumber: 'ACC123',
            licenseKey: 'encrypted-license-key',  // 修正：21文字に変更
            status: 'Active',
            eaName: 'Test EA',
            broker: 'Test Broker'
        };

        it('開発者が自分のライセンスを取り消しできる', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer',
                body: {
                    reason: 'No longer needed'
                }
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.message).toBe('License revoked successfully');
            expect(body.data.status).toBe('Revoked');
            expect(body.data.eaName).toBe('Test EA');
            expect(body.data.licenseKey).toBe('encrypted-...');
            expect(body.data.reason).toBe('No longer needed');

            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, `APPLICATION#${applicationId}`);
            expect(mockEAApplicationRepository.updateStatus).toHaveBeenCalledWith(userId, `APPLICATION#${applicationId}`, 'Revoked');
            expect(mockEAApplicationRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK: `APPLICATION#${applicationId}`,
                action: 'Revoked',
                changedBy: userId,
                previousStatus: 'Active',
                newStatus: 'Revoked',
                reason: 'No longer needed'
            });
        });

        it('理由が指定されていない場合でも取り消しできる', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.data.reason).toBe(`License revoked by developer: ${userId}`);
        });

        it('管理者は他のユーザーのライセンスを取り消しできる', async () => {
            const adminId = 'admin-user-id';
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId: adminId,
                userRole: 'admin',
                body: {
                    reason: 'Policy violation'
                }
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            expect(body.data.reason).toBe('Policy violation');
        });

        it('APPLICATION#プレフィックスがすでに付いている場合も正常に処理できる', async () => {
            const event = createTestEvent({
                pathParameters: { id: `APPLICATION#${applicationId}` },
                userId,
                userRole: 'developer'
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            expect(mockEAApplicationRepository.getApplication).toHaveBeenCalledWith(userId, `APPLICATION#${applicationId}`);
        });
    });

    describe('エラーケース', () => {
        const userId = 'test-user-id';
        const applicationId = 'test-app-id';
        const mockApplication = {
            userId,
            sk: `APPLICATION#${applicationId}`,
            accountNumber: 'ACC123',
            licenseKey: 'encrypted-license-key',  // 修正：ここも同じに
            status: 'Active',
            eaName: 'Test EA',
            broker: 'Test Broker'
        };

        it('アプリケーションが見つからない場合は404エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(null);

            const result = await handler(event);

            expect(result.statusCode).toBe(404);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Application not found');
        });

        it('開発者が他のユーザーのライセンスを取り消そうとした場合は403エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId: 'different-user-id',
                userRole: 'developer'
            });

            const otherUserApplication = {
                ...mockApplication,
                userId: 'original-owner-id'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(otherUserApplication);

            const result = await handler(event);

            expect(result.statusCode).toBe(403);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Access denied: You can only revoke your own licenses');
        });

        it('ライセンスがActive状態でない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });

            const inactiveApplication = {
                ...mockApplication,
                status: 'Expired'
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(inactiveApplication);

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Application is in Expired status. Only Active licenses can be revoked.');
        });

        it('ライセンスキーがない場合は400エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });

            const appWithoutLicense = {
                ...mockApplication,
                licenseKey: undefined
            };

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(appWithoutLicense);

            const result = await handler(event);

            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('No license key found for this application');
        });

        it('不正なJSONボディの場合でも処理を続行できる', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });
            event.body = 'invalid json';

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.data.reason).toBe(`License revoked by developer: ${userId}`);
        });

        it('リポジトリアクセスでエラーが発生した場合は500エラーを返す', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId,
                userRole: 'developer'
            });

            mockEAApplicationRepository.getApplication.mockRejectedValueOnce(new Error('DB Error'));

            const result = await handler(event);

            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(false);
            expect(body.message).toBe('Failed to revoke license');
            expect(body.data?.error).toBe('DB Error');
        });
    });

    describe('権限とロールの検証', () => {
        const userId = 'test-user-id';
        const applicationId = 'test-app-id';
        const mockApplication = {
            userId,
            sk: `APPLICATION#${applicationId}`,
            accountNumber: 'ACC123',
            licenseKey: 'encrypted-license-key',
            status: 'Active',
            eaName: 'Test EA',
            broker: 'Test Broker'
        };

        it('ロールが指定されていない場合はdeveloperとして扱う', async () => {
            const event = createTestEvent({
                pathParameters: { id: applicationId },
                userId
            });
            // ロールを明示的に削除
            delete event.requestContext.authorizer?.claims?.role;

            mockEAApplicationRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockEAApplicationRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'Revoked'
            });
            mockEAApplicationRepository.recordHistory.mockResolvedValueOnce(undefined);

            const result = await handler(event);

            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.data.reason).toBe(`License revoked by developer: ${userId}`);
        });
    });
});