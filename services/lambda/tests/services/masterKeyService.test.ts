import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AwilixContainer } from 'awilix';
import { DIContainer } from '../../src/di/dependencies';
import { createTestContainer } from '../di/testContainer';
import { MasterKeyService } from '../../src/services/masterKeyService';
import { SSMClient } from '@aws-sdk/client-ssm';

describe('MasterKeyService', () => {
    let container: AwilixContainer<DIContainer>;
    let service: MasterKeyService;
    let mockSSMClient: SSMClient;
    let mockLogger: any;

    beforeEach(() => {
        // 環境変数の設定（必須）
        process.env.ENVIRONMENT = 'test';
        process.env.SSM_USER_PREFIX = '/sankey/test/users';

        // 実サービスインスタンスを使用（必須）
        container = createTestContainer();
        service = container.resolve('masterKeyService');
        mockSSMClient = container.resolve('ssmClient');
        mockLogger = container.resolve('logger');
    });

    afterEach(() => {
        vi.clearAllMocks();
        // 環境変数のクリーンアップ（必須）
        delete process.env.ENVIRONMENT;
        delete process.env.SSM_USER_PREFIX;
    });

    describe('ensureMasterKeyExists', () => {
        it('マスターキーが存在しない場合は作成する', async () => {
            const userId = 'test-user-id';
            const email = 'test@example.com';

            // GetParameterCommandでParameterNotFoundエラー
            const notFoundError = Object.assign(
                new Error('ParameterNotFound'),
                { name: 'ParameterNotFound' }
            );

            const mockSend = vi.fn()
                .mockRejectedValueOnce(notFoundError) // GetParameterCommand - not found
                .mockResolvedValueOnce({}); // PutParameterCommand - success

            (mockSSMClient.send as any) = mockSend;

            await service.ensureMasterKeyExists(userId, email);

            expect(mockSend).toHaveBeenCalledTimes(2);
            // GetParameterCommandの呼び出し確認
            expect(mockSend.mock.calls[0][0].constructor.name).toBe('GetParameterCommand');
            // PutParameterCommandの呼び出し確認
            expect(mockSend.mock.calls[1][0].constructor.name).toBe('PutParameterCommand');
        });

        it('マスターキーが既に存在する場合は何もしない', async () => {
            const userId = 'test-user-id';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: 'existing-key' }
            });

            (mockSSMClient.send as any) = mockSend;

            await service.ensureMasterKeyExists(userId);

            expect(mockSend).toHaveBeenCalledTimes(1);
            expect(mockSend.mock.calls[0][0].constructor.name).toBe('GetParameterCommand');
        });

        it('予期しないエラーの場合は再スロー', async () => {
            const userId = 'test-user-id';
            const unexpectedError = new Error('Unexpected error');

            const mockSend = vi.fn().mockRejectedValueOnce(unexpectedError);
            (mockSSMClient.send as any) = mockSend;

            await expect(service.ensureMasterKeyExists(userId))
                .rejects.toThrow('Unexpected error');
        });
    });

    describe('getUserMasterKey', () => {
        it('マスターキーを正常に取得してCryptoKeyとして返す', async () => {
            const userId = 'test-user-id';
            const masterKeyBase64 = Buffer.from(new Uint8Array(32)).toString('base64'); // 32 bytes

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: masterKeyBase64 }
            });
            (mockSSMClient.send as any) = mockSend;

            const result = await service.getUserMasterKey(userId);

            expect(result).toBeDefined();
            expect(result.type).toBe('secret');
            expect(result.algorithm.name).toBe('AES-CBC');
        });

        it('パラメータが見つからない場合はエラーをスロー', async () => {
            const userId = 'test-user-id';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: null
            });
            (mockSSMClient.send as any) = mockSend;

            await expect(service.getUserMasterKey(userId))
                .rejects.toThrow(`Failed to retrieve encryption key for user: ${userId}`);
        });

        it('無効な長さのキーの場合はエラーをスロー', async () => {
            const userId = 'test-user-id';
            const invalidKeyBase64 = Buffer.from(new Uint8Array(16)).toString('base64'); // 16 bytes（無効）

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: invalidKeyBase64 }
            });
            (mockSSMClient.send as any) = mockSend;

            await expect(service.getUserMasterKey(userId))
                .rejects.toThrow('Invalid master key length. Expected 256-bit key.');
        });

        it('ParameterNotFoundエラーの場合は適切なメッセージでエラーをスロー', async () => {
            const userId = 'test-user-id';

            const notFoundError = Object.assign(
                new Error('ParameterNotFound'),
                { name: 'ParameterNotFound' }
            );

            const mockSend = vi.fn().mockRejectedValueOnce(notFoundError);
            (mockSSMClient.send as any) = mockSend;

            await expect(service.getUserMasterKey(userId))
                .rejects.toThrow(`Master key not found for user: ${userId}`);
        });

        it('AccessDeniedエラーの場合は適切なメッセージでエラーをスロー', async () => {
            const userId = 'test-user-id';

            const accessDeniedError = Object.assign(
                new Error('AccessDenied'),
                { name: 'AccessDenied' }
            );

            const mockSend = vi.fn().mockRejectedValueOnce(accessDeniedError);
            (mockSSMClient.send as any) = mockSend;

            await expect(service.getUserMasterKey(userId))
                .rejects.toThrow(`Access denied to master key for user: ${userId}`);
        });
    });

    describe('getUserMasterKeyForEncryption', () => {
        it('暗号化用のマスターキーを取得できる', async () => {
            const userId = 'test-user-id';
            const masterKeyBase64 = Buffer.from(new Uint8Array(32)).toString('base64');

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: masterKeyBase64 }
            });
            (mockSSMClient.send as any) = mockSend;

            const result = await service.getUserMasterKeyForEncryption(userId);

            expect(result).toBeDefined();
            expect(result.usages).toContain('encrypt');
        });
    });

    describe('getUserMasterKeyForDecryption', () => {
        it('復号化用のマスターキーを取得できる', async () => {
            const userId = 'test-user-id';
            const masterKeyBase64 = Buffer.from(new Uint8Array(32)).toString('base64');

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: masterKeyBase64 }
            });
            (mockSSMClient.send as any) = mockSend;

            const result = await service.getUserMasterKeyForDecryption(userId);

            expect(result).toBeDefined();
            expect(result.usages).toContain('decrypt');
        });
    });

    describe('getUserMasterKeyRaw', () => {
        it('マスターキーの原始データを取得できる', async () => {
            const userId = 'test-user-id';
            const expectedKey = 'base64-encoded-master-key';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: expectedKey }
            });
            (mockSSMClient.send as any) = mockSend;

            const result = await service.getUserMasterKeyRaw(userId);

            expect(result).toBe(expectedKey);
        });

        it('パラメータが見つからない場合はエラーをスロー', async () => {
            const userId = 'test-user-id';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: null
            });
            (mockSSMClient.send as any) = mockSend;

            await expect(service.getUserMasterKeyRaw(userId))
                .rejects.toThrow(`Failed to retrieve raw master key for user: ${userId}`);
        });
    });

    describe('hasMasterKey', () => {
        it('マスターキーが存在する場合はtrueを返す', async () => {
            const userId = 'test-user-id';

            const mockSend = vi.fn().mockResolvedValueOnce({
                Parameter: { Value: 'existing-key' }
            });
            (mockSSMClient.send as any) = mockSend;

            const result = await service.hasMasterKey(userId);

            expect(result).toBe(true);
        });

        it('マスターキーが存在しない場合はfalseを返す', async () => {
            const userId = 'test-user-id';

            const notFoundError = Object.assign(
                new Error('ParameterNotFound'),
                { name: 'ParameterNotFound' }
            );

            const mockSend = vi.fn().mockRejectedValueOnce(notFoundError);
            (mockSSMClient.send as any) = mockSend;

            const result = await service.hasMasterKey(userId);

            expect(result).toBe(false);
        });

        it('その他のエラーの場合はエラーをスロー', async () => {
            const userId = 'test-user-id';
            const unexpectedError = new Error('Unexpected error');

            const mockSend = vi.fn().mockRejectedValueOnce(unexpectedError);
            (mockSSMClient.send as any) = mockSend;

            await expect(service.hasMasterKey(userId))
                .rejects.toThrow(`Failed to check master key existence for user: ${userId}`);
        });
    });
});