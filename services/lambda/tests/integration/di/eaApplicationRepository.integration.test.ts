// tests/integration/di/eaApplicationRepository.integration.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProductionContainer, clearContainer } from '../../../src/di/container';
import { EAApplicationRepository } from '../../../src/repositories/eaApplicationRepository';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';

describe('EAApplicationRepository 統合テスト', () => {
    let container: AwilixContainer<DIContainer>;
    let repository: EAApplicationRepository;

    beforeEach(() => {
        // 本番用コンテナを使用
        container = createProductionContainer();
        repository = container.resolve('eaApplicationRepository');
    });

    afterEach(() => {
        clearContainer();
    });

    it('本番DIコンテナから正しく解決されること', () => {
        expect(repository).toBeDefined();
        expect(repository).toBeInstanceOf(EAApplicationRepository);
    });

    it('実際のDynamoDBDocumentClientが注入されていること', () => {
        // @ts-expect-error - private propertyへのアクセス
        const docClient = repository.docClient;
        expect(docClient).toBeDefined();
        expect(docClient.constructor.name).toBe('DynamoDBDocumentClient');
    });

    it('実際のLoggerが注入されていること', () => {
        // @ts-expect-error - private propertyへのアクセス
        const logger = repository.logger;
        expect(logger).toBeDefined();
        expect(logger.constructor.name).toBe('Logger');
    });

    it('tableNameが正しく設定されていること', () => {
        // @ts-expect-error - private propertyへのアクセス
        const tableName = repository.tableName;
        expect(tableName).toBeDefined();
        expect(typeof tableName).toBe('string');
        // 環境変数またはデフォルト値が設定されているはず
        expect(tableName).toBe(process.env.TABLE_NAME || 'ea-applications');
    });

    it('依存関係が正しく動作すること', () => {
        // リポジトリのメソッドが呼び出し可能であることを確認
        expect(repository.createApplication).toBeDefined();
        expect(repository.getApplication).toBeDefined();
        expect(repository.updateStatus).toBeDefined();
        expect(repository.recordHistory).toBeDefined();
        expect(repository.getApplicationHistories).toBeDefined();

        // 全てのメソッドが正しく定義されていることを確認
        const methods = [
            'createApplication',
            'getApplication',
            'getApplicationsByStatus',
            'getAllApplications',
            'getActiveApplicationByBrokerAccount',
            'updateStatus',
            'recordHistory',
            'setHistoryTTL',
            'updateStatusWithHistoryTTL',
            'activateApplicationWithLicense',
            'cancelApplication',
            'getApplicationHistories',
            'deleteApplication',
            'updateApprovalInfo',
            'expireApplication',
            'adjustTTL'
        ];

        methods.forEach(method => {
            expect(repository[method as keyof EAApplicationRepository]).toBeDefined();
            expect(typeof repository[method as keyof EAApplicationRepository]).toBe('function');
        });
    });
});