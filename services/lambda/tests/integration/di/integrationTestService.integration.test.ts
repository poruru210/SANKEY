import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProductionContainer, clearContainer } from '../../../src/di/container';
import { IntegrationTestService } from '../../../src/services/integrationTestService';
import { IntegrationTestRepository } from '../../../src/repositories/integrationTestRepository';
import { EAApplicationRepository } from '../../../src/repositories/eaApplicationRepository';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/di/dependencies';

describe('IntegrationTestService DI Integration', () => {
    let container: AwilixContainer<DIContainer>;
    let service: IntegrationTestService;

    beforeEach(() => {
        // 環境変数の設定
        process.env.ENVIRONMENT = 'test';
        process.env.USERS_TABLE = 'test-user-profiles';
        process.env.EA_APPLICATIONS_TABLE = 'test-ea-applications';
        process.env.TABLE_NAME = 'test-applications-table';

        // 本番用コンテナを使用
        container = createProductionContainer();
        service = container.resolve('integrationTestService');
    });

    afterEach(() => {
        clearContainer();
        delete process.env.ENVIRONMENT;
        delete process.env.USERS_TABLE;
        delete process.env.EA_APPLICATIONS_TABLE;
        delete process.env.TABLE_NAME;
    });

    describe('サービスの解決', () => {
        it('DIコンテナから実際のサービスインスタンスを取得できる', () => {
            expect(service).toBeDefined();
            expect(service).toBeInstanceOf(IntegrationTestService);
        });

        it('複数回resolveしても同じインスタンスを返す（シングルトン）', () => {
            const service1 = container.resolve('integrationTestService');
            const service2 = container.resolve('integrationTestService');

            expect(service1).toBe(service2);
        });
    });

    describe('依存関係の注入', () => {
        it('DynamoDBDocumentClientが正しく注入されている', () => {
            const serviceAny = service as any;
            expect(serviceAny.docClient).toBeDefined();
            expect(serviceAny.docClient.send).toBeDefined();
        });

        it('IntegrationTestRepositoryが正しく注入されている', () => {
            const serviceAny = service as any;
            expect(serviceAny.integrationTestRepository).toBeDefined();
            expect(serviceAny.integrationTestRepository).toBeInstanceOf(IntegrationTestRepository);
        });

        it('EAApplicationRepositoryが正しく注入されている', () => {
            const serviceAny = service as any;
            expect(serviceAny.eaApplicationRepository).toBeDefined();
            expect(serviceAny.eaApplicationRepository).toBeInstanceOf(EAApplicationRepository);
        });

        it('Loggerが正しく注入されている', () => {
            const serviceAny = service as any;
            expect(serviceAny.logger).toBeDefined();
            expect(serviceAny.logger.info).toBeDefined();
            expect(serviceAny.logger.error).toBeDefined();
        });
    });

    describe('メソッドの存在確認', () => {
        it('すべての公開メソッドが存在する', () => {
            expect(service.startIntegrationTest).toBeDefined();
            expect(service.recordTestStarted).toBeDefined();
            expect(service.recordProgress).toBeDefined();
            expect(service.cleanupIntegrationTestData).toBeDefined();
            expect(service.getIntegrationTestStatus).toBeDefined();
            expect(service.isIntegrationTestApplication).toBeDefined();
            expect(service.findIntegrationTestApplications).toBeDefined();
        });
    });

    describe('リポジトリとの連携', () => {
        it('IntegrationTestRepositoryも正しく解決される', () => {
            const repository = container.resolve('integrationTestRepository');

            expect(repository).toBeDefined();
            expect(repository).toBeInstanceOf(IntegrationTestRepository);

            // 依存関係の確認（プロパティ名をdocClientに変更）
            const repoAny = repository as any;
            expect(repoAny.docClient).toBeDefined();
            expect(repoAny.tableName).toBe('user-profiles');
        });

        it('EAApplicationRepositoryも正しく解決される', () => {
            const repository = container.resolve('eaApplicationRepository');

            expect(repository).toBeDefined();
            expect(repository).toBeInstanceOf(EAApplicationRepository);

            // 依存関係の確認
            const repoAny = repository as any;
            expect(repoAny.docClient).toBeDefined();
            expect(repoAny.tableName).toBe('test-applications-table');
        });
    });

    describe('環境変数の影響', () => {
        it('TABLE_NAMEが変更された場合、新しいコンテナで反映される', () => {
            // 現在のサービスの値を確認
            const serviceAny = service as any;
            expect(serviceAny.applicationsTableName).toBe('test-applications-table');

            // 環境変数を変更して新しいコンテナを作成
            clearContainer();
            process.env.TABLE_NAME = 'new-applications-table';

            const newContainer = createProductionContainer();
            const newService = newContainer.resolve('integrationTestService');
            const newServiceAny = newService as any;

            expect(newServiceAny.applicationsTableName).toBe('new-applications-table');

            // クリーンアップ
            clearContainer();
        });
    });
});