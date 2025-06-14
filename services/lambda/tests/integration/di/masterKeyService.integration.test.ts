import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AwilixContainer } from 'awilix';
import { DIContainer } from '../../../src/di/dependencies';
import { createProductionContainer, clearContainer } from '../../../src/di/container';
import { MasterKeyService } from '../../../src/services/masterKeyService';

describe('MasterKeyService DI Integration', () => {
    let container: AwilixContainer<DIContainer>;

    beforeEach(() => {
        // 環境変数を設定
        process.env.ENVIRONMENT = 'test';
        process.env.AWS_REGION = 'ap-northeast-1';
        process.env.SERVICE_NAME = 'test-service';
        process.env.LOG_LEVEL = 'ERROR';
        process.env.SSM_USER_PREFIX = '/sankey/test/users';

        // 本番用のコンテナを作成
        container = createProductionContainer();
    });

    afterEach(() => {
        // コンテナをクリーンアップ
        clearContainer();
    });

    describe('サービスの解決', () => {
        it('DIコンテナから実際のサービスインスタンスを取得できる', () => {
            // Act
            const service = container.resolve('masterKeyService');

            // Assert
            expect(service).toBeInstanceOf(MasterKeyService);
        });

        it('複数回resolveしても同じインスタンスを返す（シングルトン）', () => {
            // Act
            const service1 = container.resolve('masterKeyService');
            const service2 = container.resolve('masterKeyService');

            // Assert
            expect(service1).toBe(service2);
        });
    });

    describe('依存関係の注入', () => {
        it('SSMクライアントが正しく注入されている', () => {
            // Act
            const service = container.resolve('masterKeyService');
            const serviceAny = service as any;

            // Assert
            expect(serviceAny.ssmClient).toBeDefined();
            expect(serviceAny.ssmClient.send).toBeDefined();
        });

        it('Loggerが正しく注入されている', () => {
            // Act
            const service = container.resolve('masterKeyService');
            const serviceAny = service as any;

            // Assert
            expect(serviceAny.logger).toBeDefined();
            expect(serviceAny.logger.info).toBeDefined();
            expect(serviceAny.logger.error).toBeDefined();
        });

        it('SSMプレフィックスが環境変数から正しく設定されている', () => {
            // Act
            const service = container.resolve('masterKeyService');
            const serviceAny = service as any;

            // Assert
            expect(serviceAny.ssmUserPrefix).toBe('/sankey/test/users');
        });
    });

    describe('メソッドの存在確認', () => {
        it('すべての公開メソッドが存在する', () => {
            // Act
            const service = container.resolve('masterKeyService');

            // Assert
            expect(service.ensureMasterKeyExists).toBeDefined();
            expect(typeof service.ensureMasterKeyExists).toBe('function');

            expect(service.getUserMasterKey).toBeDefined();
            expect(typeof service.getUserMasterKey).toBe('function');

            expect(service.getUserMasterKeyForEncryption).toBeDefined();
            expect(typeof service.getUserMasterKeyForEncryption).toBe('function');

            expect(service.getUserMasterKeyForDecryption).toBeDefined();
            expect(typeof service.getUserMasterKeyForDecryption).toBe('function');

            expect(service.getUserMasterKeyRaw).toBeDefined();
            expect(typeof service.getUserMasterKeyRaw).toBe('function');

            expect(service.hasMasterKey).toBeDefined();
            expect(typeof service.hasMasterKey).toBe('function');
        });
    });

    describe('環境変数の影響', () => {
        it('環境変数が変更された場合、新しいコンテナで反映される', () => {
            // Arrange
            const originalPrefix = process.env.SSM_USER_PREFIX;

            // Act - 最初のコンテナ
            const service1 = container.resolve('masterKeyService');
            const service1Any = service1 as any;
            const prefix1 = service1Any.ssmUserPrefix;

            // 環境変数を変更
            process.env.SSM_USER_PREFIX = '/sankey/prod/users';

            // 新しいコンテナを作成
            clearContainer();
            const newContainer = createProductionContainer();
            const service2 = newContainer.resolve('masterKeyService');
            const service2Any = service2 as any;
            const prefix2 = service2Any.ssmUserPrefix;

            // Assert
            expect(prefix1).toBe('/sankey/test/users');
            expect(prefix2).toBe('/sankey/prod/users');

            // Cleanup
            process.env.SSM_USER_PREFIX = originalPrefix;
        });
    });
});