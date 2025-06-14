import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../src/di/dependencies';
import { createTestContainer } from '../di/testContainer';
import { IntegrationTestProgressService, IntegrationTestProgress, StepDetails } from '../../src/services/integrationTestProgressService';

describe('IntegrationTestProgressService (DI対応)', () => {
    let container: AwilixContainer<DIContainer>;
    let service: IntegrationTestProgressService;
    let mockLogger: any;

    beforeEach(() => {
        // 環境変数の設定（必須）
        process.env.ENVIRONMENT = 'test';

        // 実サービスインスタンスを使用（必須）
        container = createTestContainer();
        service = container.resolve('integrationTestProgressService');
        mockLogger = container.resolve('logger');
    });

    afterEach(() => {
        vi.clearAllMocks();
        // 環境変数のクリーンアップ（必須）
        delete process.env.ENVIRONMENT;
    });

    describe('DIコンテナからの解決', () => {
        it('サービスがDIコンテナから正しく解決されること', () => {
            expect(service).toBeDefined();
            expect(service).toBeInstanceOf(IntegrationTestProgressService);
        });

        it('loggerが注入されていること', () => {
            // @ts-expect-error - private propertyへのアクセス
            expect(service.logger).toBeDefined();
            // @ts-expect-error - private propertyへのアクセス
            expect(service.logger).toBe(mockLogger);
        });
    });

    describe('createInitialProgress', () => {
        it('初期進捗データを正しく作成すること', () => {
            const testId = 'test-123';
            const gasWebappUrl = 'https://example.com/gas';

            const progress = service.createInitialProgress(testId, gasWebappUrl);

            expect(progress.testId).toBe(testId);
            expect(progress.currentStep).toBe('STARTED');
            expect(progress.steps.STARTED).toBeDefined();
            expect(progress.steps.STARTED?.success).toBe(true);
            expect(progress.steps.STARTED?.details).toBe('Integration test started from frontend');
            expect(progress.startedAt).toBeDefined();
            expect(progress.completedAt).toBeUndefined();
            expect(progress.totalDuration).toBeUndefined();
        });

        it('タイムスタンプが正しい形式であること', () => {
            const testId = 'test-456';
            const gasWebappUrl = 'https://example.com/gas';

            const progress = service.createInitialProgress(testId, gasWebappUrl);

            // ISO 8601形式の検証
            expect(progress.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(progress.steps.STARTED?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    describe('updateProgress', () => {
        it('既存の進捗データを更新できること', () => {
            const existingProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'STARTED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true,
                        details: 'Started'
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const details: StepDetails = {
                testId: 'test-123',
                success: true,
                details: 'Webhook received'
            };

            const updated = service.updateProgress(existingProgress, 'GAS_WEBHOOK_RECEIVED', details);

            expect(updated.currentStep).toBe('GAS_WEBHOOK_RECEIVED');
            expect(updated.steps.GAS_WEBHOOK_RECEIVED).toBeDefined();
            expect(updated.steps.GAS_WEBHOOK_RECEIVED?.success).toBe(true);
            expect(updated.steps.GAS_WEBHOOK_RECEIVED?.details).toBe('Webhook received');
            expect(updated.steps.STARTED).toEqual(existingProgress.steps.STARTED);
        });

        it('新規進捗データを作成できること（既存データなし）', () => {
            const details: StepDetails = {
                testId: 'test-456',
                success: true,
                details: 'Direct webhook'
            };

            const progress = service.updateProgress(undefined, 'GAS_WEBHOOK_RECEIVED', details);

            expect(progress.testId).toBe('test-456');
            expect(progress.currentStep).toBe('GAS_WEBHOOK_RECEIVED');
            expect(progress.steps.GAS_WEBHOOK_RECEIVED).toBeDefined();
            expect(progress.steps.GAS_WEBHOOK_RECEIVED?.success).toBe(true);
            expect(progress.steps.GAS_WEBHOOK_RECEIVED?.details).toBe('Direct webhook');
            expect(progress.startedAt).toBeDefined();
        });

        it('COMPLETEDステップで完了時刻と総時間を設定すること', () => {
            const startTime = '2024-01-01T00:00:00.000Z';
            const existingProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'LICENSE_ISSUED',
                steps: {
                    STARTED: {
                        timestamp: startTime,
                        success: true
                    },
                    GAS_WEBHOOK_RECEIVED: {
                        timestamp: '2024-01-01T00:01:00.000Z',
                        success: true
                    },
                    LICENSE_ISSUED: {
                        timestamp: '2024-01-01T00:02:00.000Z',
                        success: true
                    }
                },
                startedAt: startTime
            };

            const details: StepDetails = {
                testId: 'test-123',
                success: true,
                details: 'Test completed'
            };

            const updated = service.updateProgress(existingProgress, 'COMPLETED', details);

            expect(updated.currentStep).toBe('COMPLETED');
            expect(updated.completedAt).toBeDefined();
            expect(updated.totalDuration).toBeDefined();
            expect(updated.totalDuration).toBeGreaterThan(0);
        });

        it('applicationSKが提供された場合は更新すること', () => {
            const existingProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'STARTED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const details: StepDetails = {
                testId: 'test-123',
                success: true,
                applicationSK: 'APPLICATION#2024-01-01T00:00:00Z'
            };

            const updated = service.updateProgress(existingProgress, 'GAS_WEBHOOK_RECEIVED', details);

            expect(updated.applicationSK).toBe('APPLICATION#2024-01-01T00:00:00Z');
        });

        it('エラー情報を含めて更新できること', () => {
            const existingProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'STARTED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const details: StepDetails = {
                testId: 'test-123',
                success: false,
                error: 'Webhook failed'
            };

            const updated = service.updateProgress(existingProgress, 'GAS_WEBHOOK_RECEIVED', details);

            expect(updated.steps.GAS_WEBHOOK_RECEIVED?.success).toBe(false);
            expect(updated.steps.GAS_WEBHOOK_RECEIVED?.error).toBe('Webhook failed');
        });
    });

    describe('validateProgress', () => {
        it('有効な進捗データを検証できること', () => {
            const validProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'STARTED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const result = service.validateProgress(validProgress);

            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it('testIdが欠けている場合はissueを検出すること', () => {
            const invalidProgress: IntegrationTestProgress = {
                testId: '',
                currentStep: 'STARTED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const result = service.validateProgress(invalidProgress);

            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('testId is missing');
        });

        it('COMPLETEDステップでcompletedAtが欠けている場合はissueを検出すること', () => {
            const invalidProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'COMPLETED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    },
                    GAS_WEBHOOK_RECEIVED: {
                        timestamp: '2024-01-01T00:01:00.000Z',
                        success: true
                    },
                    LICENSE_ISSUED: {
                        timestamp: '2024-01-01T00:02:00.000Z',
                        success: true
                    },
                    COMPLETED: {
                        timestamp: '2024-01-01T00:03:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
                // completedAtが欠けている
            };

            const result = service.validateProgress(invalidProgress);

            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('completedAt is missing for COMPLETED step');
        });

        it('中間ステップが欠けている場合はissueを検出すること', () => {
            const invalidProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'LICENSE_ISSUED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    },
                    // GAS_WEBHOOK_RECEIVEDが欠けている
                    LICENSE_ISSUED: {
                        timestamp: '2024-01-01T00:02:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            const result = service.validateProgress(invalidProgress);

            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('Missing step: GAS_WEBHOOK_RECEIVED');
        });
    });

    describe('getNextStep', () => {
        it('次のステップを正しく取得できること', () => {
            expect(service.getNextStep('STARTED')).toBe('GAS_WEBHOOK_RECEIVED');
            expect(service.getNextStep('GAS_WEBHOOK_RECEIVED')).toBe('LICENSE_ISSUED');
            expect(service.getNextStep('LICENSE_ISSUED')).toBe('COMPLETED');
            expect(service.getNextStep('COMPLETED')).toBeNull();
        });

        it('無効なステップの場合nullを返すこと', () => {
            expect(service.getNextStep('INVALID' as any)).toBeNull();
        });
    });

    describe('isStepCompleted', () => {
        it('完了したステップを正しく判定できること', () => {
            const progress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    },
                    GAS_WEBHOOK_RECEIVED: {
                        timestamp: '2024-01-01T00:01:00.000Z',
                        success: true
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            expect(service.isStepCompleted(progress, 'STARTED')).toBe(true);
            expect(service.isStepCompleted(progress, 'GAS_WEBHOOK_RECEIVED')).toBe(true);
            expect(service.isStepCompleted(progress, 'LICENSE_ISSUED')).toBe(false);
            expect(service.isStepCompleted(progress, 'COMPLETED')).toBe(false);
        });

        it('失敗したステップは完了と判定しないこと', () => {
            const progress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                steps: {
                    STARTED: {
                        timestamp: '2024-01-01T00:00:00.000Z',
                        success: true
                    },
                    GAS_WEBHOOK_RECEIVED: {
                        timestamp: '2024-01-01T00:01:00.000Z',
                        success: false,
                        error: 'Failed'
                    }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            expect(service.isStepCompleted(progress, 'GAS_WEBHOOK_RECEIVED')).toBe(false);
        });
    });

    describe('isAllStepsCompleted', () => {
        it('全ステップ完了を正しく判定できること', () => {
            const incompleteProgress: IntegrationTestProgress = {
                testId: 'test-123',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                steps: {
                    STARTED: { timestamp: '2024-01-01T00:00:00.000Z', success: true },
                    GAS_WEBHOOK_RECEIVED: { timestamp: '2024-01-01T00:01:00.000Z', success: true }
                },
                startedAt: '2024-01-01T00:00:00.000Z'
            };

            expect(service.isAllStepsCompleted(incompleteProgress)).toBe(false);

            const completeProgress: IntegrationTestProgress = {
                testId: 'test-456',
                currentStep: 'COMPLETED',
                steps: {
                    STARTED: { timestamp: '2024-01-01T00:00:00.000Z', success: true },
                    GAS_WEBHOOK_RECEIVED: { timestamp: '2024-01-01T00:01:00.000Z', success: true },
                    LICENSE_ISSUED: { timestamp: '2024-01-01T00:02:00.000Z', success: true },
                    COMPLETED: { timestamp: '2024-01-01T00:03:00.000Z', success: true }
                },
                startedAt: '2024-01-01T00:00:00.000Z',
                completedAt: '2024-01-01T00:03:00.000Z'
            };

            expect(service.isAllStepsCompleted(completeProgress)).toBe(true);
        });

        it('一部のステップが失敗している場合はfalseを返すこと', () => {
            const progressWithFailure: IntegrationTestProgress = {
                testId: 'test-789',
                currentStep: 'COMPLETED',
                steps: {
                    STARTED: { timestamp: '2024-01-01T00:00:00.000Z', success: true },
                    GAS_WEBHOOK_RECEIVED: { timestamp: '2024-01-01T00:01:00.000Z', success: false, error: 'Failed' },
                    LICENSE_ISSUED: { timestamp: '2024-01-01T00:02:00.000Z', success: true },
                    COMPLETED: { timestamp: '2024-01-01T00:03:00.000Z', success: true }
                },
                startedAt: '2024-01-01T00:00:00.000Z',
                completedAt: '2024-01-01T00:03:00.000Z'
            };

            expect(service.isAllStepsCompleted(progressWithFailure)).toBe(false);
        });
    });
});