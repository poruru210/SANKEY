import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProductionContainer, clearContainer } from '../../../src/di/container';
import { IntegrationTestProgressService } from '../../../src/services/integrationTestProgressService';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/di/dependencies';

describe('IntegrationTestProgressService 統合テスト', () => {
    let container: AwilixContainer<DIContainer>;
    let service: IntegrationTestProgressService;

    beforeEach(() => {
        // 本番用コンテナを使用
        container = createProductionContainer();
        service = container.resolve('integrationTestProgressService');
    });

    afterEach(() => {
        clearContainer();
    });

    it('本番DIコンテナから正しく解決されること', () => {
        expect(service).toBeDefined();
        expect(service).toBeInstanceOf(IntegrationTestProgressService);
    });

    it('実際のLoggerが注入されていること', () => {
        // @ts-expect-error - private propertyへのアクセス
        const logger = service.logger;
        expect(logger).toBeDefined();
        expect(logger.constructor.name).toBe('Logger');
    });

    it('全機能が正常に動作すること', () => {
        // 初期進捗作成
        const testId = 'integration-test-123';
        const progress = service.createInitialProgress(testId, 'https://example.com');

        expect(progress.testId).toBe(testId);
        expect(progress.currentStep).toBe('STARTED');

        // 進捗更新
        const updated = service.updateProgress(progress, 'GAS_WEBHOOK_RECEIVED', {
            testId,
            success: true,
            details: 'Webhook received in integration test'
        });

        expect(updated.currentStep).toBe('GAS_WEBHOOK_RECEIVED');

        // 検証
        const validation = service.validateProgress(updated);
        expect(validation.isValid).toBe(true);

        // 次のステップ取得
        const nextStep = service.getNextStep(updated.currentStep);
        expect(nextStep).toBe('LICENSE_ISSUED');
    });
});