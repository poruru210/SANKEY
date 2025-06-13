// src/services/integrationTestProgressService.ts

import { Logger } from '@aws-lambda-powertools/logger';

export interface IntegrationTestProgressServiceDependencies {
    logger: Logger;
}

/**
 * 統合テストの進捗管理に関するビジネスロジック
 */
export interface IntegrationTestProgress {
    testId: string;
    currentStep: IntegrationTestStep;
    steps: {
        [key in IntegrationTestStep]?: {
            timestamp: string;
            success: boolean;
            details?: string;
            error?: string;
        }
    };
    startedAt: string;
    completedAt?: string;
    totalDuration?: number;
    gasWebappUrl?: string;
    applicationSK?: string;
}

export type IntegrationTestStep = 'STARTED' | 'GAS_WEBHOOK_RECEIVED' | 'LICENSE_ISSUED' | 'COMPLETED';

export interface StepDetails {
    testId: string;
    success: boolean;
    details?: string;
    error?: string;
    gasWebappUrl?: string;
    applicationSK?: string;
}

export class IntegrationTestProgressService {
    private readonly logger: Logger;

    constructor(dependencies: IntegrationTestProgressServiceDependencies) {
        this.logger = dependencies.logger;
    }

    /**
     * 新規進捗データを作成
     */
    createInitialProgress(testId: string, gasWebappUrl: string): IntegrationTestProgress {
        const timestamp = new Date().toISOString();
        return {
            testId,
            currentStep: 'STARTED',
            steps: {
                STARTED: {
                    timestamp,
                    success: true,
                    details: 'Integration test started from frontend'
                }
            },
            startedAt: timestamp
        };
    }

    /**
     * 既存進捗データを更新
     */
    updateProgress(
        existingProgress: IntegrationTestProgress | undefined,
        step: IntegrationTestStep,
        details: StepDetails
    ): IntegrationTestProgress {
        const timestamp = new Date().toISOString();
        const stepData = {
            timestamp,
            success: details.success,
            ...(details.details && { details: details.details }),
            ...(details.error && { error: details.error })
        };

        if (existingProgress) {
            // 既存の進捗データを更新
            const updatedProgress: IntegrationTestProgress = {
                ...existingProgress,
                currentStep: step,
                steps: {
                    ...existingProgress.steps,
                    [step]: stepData
                }
            };

            // COMPLETEDの場合、完了時刻と総時間を計算
            if (step === 'COMPLETED') {
                updatedProgress.completedAt = timestamp;
                updatedProgress.totalDuration =
                    new Date(timestamp).getTime() - new Date(existingProgress.startedAt).getTime();
            }

            // applicationSKがある場合は更新
            if (details.applicationSK) {
                updatedProgress.applicationSK = details.applicationSK;
            }

            return updatedProgress;
        } else {
            // 新規進捗データを作成（STARTEDステップ以外で既存データがない場合）
            const newProgress: IntegrationTestProgress = {
                testId: details.testId,
                currentStep: step,
                steps: { [step]: stepData },
                startedAt: timestamp
            };

            if (step === 'COMPLETED') {
                newProgress.completedAt = timestamp;
                newProgress.totalDuration = 0;
            }

            if (details.applicationSK) {
                newProgress.applicationSK = details.applicationSK;
            }

            return newProgress;
        }
    }

    /**
     * 進捗の検証
     */
    validateProgress(progress: IntegrationTestProgress): {
        isValid: boolean;
        issues: string[];
    } {
        const issues: string[] = [];

        if (!progress.testId) {
            issues.push('testId is missing');
        }

        if (!progress.startedAt) {
            issues.push('startedAt is missing');
        }

        if (progress.currentStep === 'COMPLETED' && !progress.completedAt) {
            issues.push('completedAt is missing for COMPLETED step');
        }

        // ステップの順序検証
        const expectedOrder: IntegrationTestStep[] = [
            'STARTED',
            'GAS_WEBHOOK_RECEIVED',
            'LICENSE_ISSUED',
            'COMPLETED'
        ];

        const currentIndex = expectedOrder.indexOf(progress.currentStep);
        const completedSteps = Object.keys(progress.steps) as IntegrationTestStep[];

        // 現在のステップまでのすべてのステップが存在するか確認
        for (let i = 0; i <= currentIndex; i++) {
            if (!completedSteps.includes(expectedOrder[i])) {
                issues.push(`Missing step: ${expectedOrder[i]}`);
            }
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    }

    /**
     * 次のステップを取得
     */
    getNextStep(currentStep: IntegrationTestStep): IntegrationTestStep | null {
        const stepOrder: IntegrationTestStep[] = [
            'STARTED',
            'GAS_WEBHOOK_RECEIVED',
            'LICENSE_ISSUED',
            'COMPLETED'
        ];

        const currentIndex = stepOrder.indexOf(currentStep);
        if (currentIndex === -1 || currentIndex === stepOrder.length - 1) {
            return null;
        }

        return stepOrder[currentIndex + 1];
    }

    /**
     * ステップが完了しているか確認
     */
    isStepCompleted(progress: IntegrationTestProgress, step: IntegrationTestStep): boolean {
        return !!progress.steps[step]?.success;
    }

    /**
     * すべてのステップが完了しているか確認
     */
    isAllStepsCompleted(progress: IntegrationTestProgress): boolean {
        const requiredSteps: IntegrationTestStep[] = [
            'STARTED',
            'GAS_WEBHOOK_RECEIVED',
            'LICENSE_ISSUED',
            'COMPLETED'
        ];

        return requiredSteps.every(step => this.isStepCompleted(progress, step));
    }
}