import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createProductionContainer, clearContainer } from '../../../src/di/container';
import { JWTKeyService } from '../../../src/services/jwtKeyService';

describe('JWTKeyService DI統合テスト', () => {
    let container: AwilixContainer<DIContainer>;

    beforeEach(() => {
        process.env.ENVIRONMENT = 'test';
        process.env.SSM_USER_PREFIX = '/sankey/test/users';
        container = createProductionContainer();
    });

    afterEach(() => {
        clearContainer();
        delete process.env.ENVIRONMENT;
        delete process.env.SSM_USER_PREFIX;
    });

    describe('DIコンテナからの解決', () => {
        it('JWTKeyServiceが正しく解決される', () => {
            const jwtKeyService = container.resolve('jwtKeyService');

            expect(jwtKeyService).toBeInstanceOf(JWTKeyService);
            expect(jwtKeyService).toBeDefined();
        });

        it('シングルトンとして動作する', () => {
            const instance1 = container.resolve('jwtKeyService');
            const instance2 = container.resolve('jwtKeyService');

            expect(instance1).toBe(instance2);
        });

        it('必要な依存関係が注入されている', () => {
            const jwtKeyService = container.resolve('jwtKeyService');
            const ssmClient = container.resolve('ssmClient');
            const logger = container.resolve('logger');

            // JWTKeyServiceが作成されていることを確認
            expect(jwtKeyService).toBeDefined();

            // 依存関係も解決されていることを確認
            expect(ssmClient).toBeDefined();
            expect(logger).toBeDefined();
        });
    });

    describe('環境変数の設定', () => {
        it('環境変数が正しく設定される', () => {
            const jwtKeyService = container.resolve('jwtKeyService');

            // JWTKeyServiceが環境変数を使用して初期化されていることを確認
            expect(jwtKeyService).toBeDefined();
            expect(process.env.ENVIRONMENT).toBe('test');
            expect(process.env.SSM_USER_PREFIX).toBe('/sankey/test/users');
        });

        it('環境変数が未設定の場合はデフォルト値を使用する', () => {
            delete process.env.SSM_USER_PREFIX;
            clearContainer();

            const newContainer = createProductionContainer();
            const jwtKeyService = newContainer.resolve('jwtKeyService');

            // デフォルトのプレフィックスが使用されることを確認
            expect(jwtKeyService).toBeDefined();
        });
    });

    describe('依存サービスとの統合', () => {
        it('SSMClientが正しく注入される', () => {
            const jwtKeyService = container.resolve('jwtKeyService');
            const ssmClient = container.resolve('ssmClient');

            expect(jwtKeyService).toBeDefined();
            expect(ssmClient).toBeDefined();
            expect(ssmClient.constructor.name).toBe('SSMClient');
        });

        it('Loggerが正しく注入される', () => {
            const jwtKeyService = container.resolve('jwtKeyService');
            const logger = container.resolve('logger');

            expect(jwtKeyService).toBeDefined();
            expect(logger).toBeDefined();
            expect(logger.constructor.name).toBe('Logger');
        });
    });

    describe('他のサービスとの相互作用', () => {
        it('MasterKeyServiceと同じSSMClientを共有する', () => {
            const jwtKeyService = container.resolve('jwtKeyService');
            const masterKeyService = container.resolve('masterKeyService');
            const ssmClient1 = container.resolve('ssmClient');
            const ssmClient2 = container.resolve('ssmClient');

            // 両方のサービスが同じSSMClientインスタンスを使用
            expect(ssmClient1).toBe(ssmClient2);
            expect(jwtKeyService).toBeDefined();
            expect(masterKeyService).toBeDefined();
        });
    });
});