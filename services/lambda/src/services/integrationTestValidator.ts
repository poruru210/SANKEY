import { EAApplication } from '../models/eaApplication';
import { IntegrationTestProgress } from './integrationTestProgressService';

export interface IntegrationTestState {
    hasProgress: boolean;
    testId?: string;
    currentStep?: string;
    gasWebappUrl?: string;
}

export interface ValidationResult {
    isValid: boolean;
    currentState?: IntegrationTestState;
    issues: string[];
}

/**
 * 統合テストの検証・判定を担当するクラス
 */
export class IntegrationTestValidator {
    /**
     * アプリケーションが統合テストかどうかを判定
     */
    static isIntegrationTestApplication(application: EAApplication): boolean {
        // 1. integrationTestIdが存在する場合は確実に統合テスト
        if (application.integrationTestId) {
            return true;
        }

        // 2. 特定のパターンに一致する場合も統合テスト
        return (
            application.accountNumber === 'INTEGRATION_TEST_123456' ||
            application.broker === 'Test Broker' ||
            application.eaName === 'Integration Test EA'
        );
    }

    /**
     * SKから統合テストの可能性があるかを事前判定（高速化のため）
     */
    static isLikelyIntegrationTestBySK(applicationSK: string): boolean {
        // SKの形式: APPLICATION#{timestamp}#{broker}#{accountNumber}#{eaName}
        const skParts = applicationSK.split('#');
        if (skParts.length < 5 || skParts[0] !== 'APPLICATION') {
            return false;
        }

        const [, , broker, accountNumber, eaName] = skParts;

        return (
            accountNumber === 'INTEGRATION_TEST_123456' ||
            broker === 'Test Broker' ||
            eaName === 'Integration Test EA' ||
            applicationSK.includes('INTEGRATION_') ||
            applicationSK.includes('Test')
        );
    }

    /**
     * 統合テスト状態を検証
     */
    static validateIntegrationTestState(
        integrationTestData: any
    ): ValidationResult {
        const issues: string[] = [];

        if (!integrationTestData) {
            return {
                isValid: true,
                currentState: { hasProgress: false },
                issues: []
            };
        }

        const progress = integrationTestData.progress;
        const gasWebappUrl = integrationTestData.gasWebappUrl;

        if (!progress) {
            if (gasWebappUrl) {
                issues.push('gasWebappUrl exists but no progress data found');
            }
            return {
                isValid: issues.length === 0,
                currentState: { hasProgress: false, gasWebappUrl },
                issues
            };
        }

        // 進捗データの整合性チェック
        if (!progress.testId) {
            issues.push('Progress exists but testId is missing');
        }

        if (!progress.startedAt) {
            issues.push('Progress exists but startedAt is missing');
        }

        if (progress.currentStep === 'COMPLETED' && !progress.completedAt) {
            issues.push('Current step is COMPLETED but completedAt is missing');
        }

        // gasWebappURLとSTARTEDステップの整合性
        if (progress.steps?.STARTED && !gasWebappUrl) {
            issues.push('STARTED step exists but gasWebappUrl is missing');
        }

        return {
            isValid: issues.length === 0,
            currentState: {
                hasProgress: true,
                testId: progress.testId,
                currentStep: progress.currentStep,
                gasWebappUrl
            },
            issues
        };
    }

    /**
     * testIdの妥当性を検証
     */
    static validateTestId(testId: string): boolean {
        // testIdの形式: INTEGRATION_{timestamp}_{randomString}
        const pattern = /^INTEGRATION_\d+_[a-z0-9]+$/;
        return pattern.test(testId);
    }

    /**
     * ステップ遷移の妥当性を検証
     */
    static canTransitionToStep(
        currentStep: string | undefined,
        targetStep: string
    ): boolean {
        const stepOrder = ['STARTED', 'GAS_WEBHOOK_RECEIVED', 'LICENSE_ISSUED', 'COMPLETED'];

        if (!currentStep) {
            // 初回は必ずSTARTEDから
            return targetStep === 'STARTED';
        }

        const currentIndex = stepOrder.indexOf(currentStep);
        const targetIndex = stepOrder.indexOf(targetStep);

        if (currentIndex === -1 || targetIndex === -1) {
            return false;
        }

        // 次のステップへの遷移、または同じステップの再記録を許可
        return targetIndex === currentIndex + 1 || targetIndex === currentIndex;
    }

    /**
     * エラーが致命的かどうかを判定
     */
    static isFatalError(step: string, error: Error): boolean {
        // GAS_WEBHOOK_RECEIVED と STARTED の失敗は致命的
        if (step === 'GAS_WEBHOOK_RECEIVED' || step === 'STARTED') {
            return true;
        }

        // 特定のエラータイプは常に致命的
        const fatalErrorPatterns = [
            /ValidationException/,
            /ResourceNotFoundException/,
            /AccessDeniedException/
        ];

        const errorMessage = error.message || '';
        return fatalErrorPatterns.some(pattern => pattern.test(errorMessage));
    }

    /**
     * クリーンアップが必要かどうかを判定
     */
    static shouldCleanupProgress(
        progress: IntegrationTestProgress | undefined,
        targetTestId: string
    ): boolean {
        if (!progress) {
            return false;
        }

        // testIdが一致し、完了している場合はクリーンアップ対象
        return progress.testId === targetTestId && progress.currentStep === 'COMPLETED';
    }
}