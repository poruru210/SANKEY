import { httpClient } from "@/lib/http-client"

/**
 * プラン情報の型定義
 */
export interface PlanLimits {
    rateLimit: number;
    burstLimit: number;
    quotaLimit: number;
    quotaPeriod: string;
}

export interface CurrentPlanInfo {
    currentTier: string | null;
    apiKeyId: string;
    apiKeyName?: string;
    usagePlanId: string | null;
    limits: PlanLimits | null;
}

export interface PlanInfo {
    current: CurrentPlanInfo;
    available: Record<string, PlanLimits>;
}

export interface ChangePlanRequest {
    userId?: string;
    newTier: 'free' | 'basic' | 'pro';
}

export interface ChangePlanResponse {
    apiKeyId: string;
    newTier: string;
    usagePlanId: string;
    previousTier: string | null;
    changedAt: string;
}

export type PlanTier = 'free' | 'basic' | 'pro';

/**
 * Plan Service固有エラー
 */
export class PlanServiceError extends Error {
    constructor(
        message: string,
        public status: number = 500,
        public code?: string
    ) {
        super(message)
        this.name = 'PlanServiceError'
    }
}

/**
 * Plan Service
 * Usage Plans管理に特化したサービス
 */
export class PlanService {

    /**
     * 現在のプラン情報取得
     */
    async getPlanInfo(): Promise<PlanInfo> {
        try {
            const response = await httpClient.get<any>('/plans')

            // 統一レスポンス形式からデータを取得
            return response.data
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new PlanServiceError(
                    `errors.planService.getFailed`, // Key for "Failed to get plan information: {message}"
                    httpError.status,
                    'GET_PLAN_FAILED'
                )
            }
            throw new PlanServiceError('errors.planService.getFailed', 500, 'GET_PLAN_FAILED_UNKNOWN')
        }
    }

    /**
     * プラン変更
     */
    async changePlan(newTier: PlanTier, userId?: string): Promise<ChangePlanResponse> {
        try {
            const requestBody: ChangePlanRequest = {
                newTier,
                ...(userId && { userId })
            }

            const response = await httpClient.post<any>('/plans/change', requestBody)

            // 統一レスポンス形式からデータを取得
            return response.data
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new PlanServiceError(
                    `errors.planService.changeFailed`, // Key for "Failed to change plan: {message}"
                    httpError.status,
                    'CHANGE_PLAN_FAILED'
                )
            }
            throw new PlanServiceError('errors.planService.changeFailed', 500, 'CHANGE_PLAN_FAILED_UNKNOWN')
        }
    }

    /**
     * プラン情報の解析・ユーティリティ
     */

    /**
     * 現在のプランがアップグレード可能かチェック
     */
    canUpgrade(currentTier: string | null): boolean {
        if (!currentTier) return true

        const tierHierarchy: PlanTier[] = ['free', 'basic', 'pro']
        const currentIndex = tierHierarchy.indexOf(currentTier as PlanTier)

        return currentIndex !== -1 && currentIndex < tierHierarchy.length - 1
    }

    /**
     * 現在のプランがダウングレード可能かチェック
     */
    canDowngrade(currentTier: string | null): boolean {
        if (!currentTier) return false

        const tierHierarchy: PlanTier[] = ['free', 'basic', 'pro']
        const currentIndex = tierHierarchy.indexOf(currentTier as PlanTier)

        return currentIndex > 0
    }

    /**
     * 利用可能なアップグレードオプション取得
     */
    getUpgradeOptions(currentTier: string | null): PlanTier[] {
        if (!currentTier) return ['free', 'basic', 'pro']

        const tierHierarchy: PlanTier[] = ['free', 'basic', 'pro']
        const currentIndex = tierHierarchy.indexOf(currentTier as PlanTier)

        if (currentIndex === -1) return tierHierarchy

        return tierHierarchy.slice(currentIndex + 1)
    }

    /**
     * 利用可能なダウングレードオプション取得
     */
    getDowngradeOptions(currentTier: string | null): PlanTier[] {
        if (!currentTier) return []

        const tierHierarchy: PlanTier[] = ['free', 'basic', 'pro']
        const currentIndex = tierHierarchy.indexOf(currentTier as PlanTier)

        if (currentIndex <= 0) return []

        return tierHierarchy.slice(0, currentIndex)
    }

    /**
     * プラン制限の比較
     */
    comparePlans(plan1: PlanLimits, plan2: PlanLimits): {
        rateIncrease: number;
        quotaIncrease: number;
        isBetter: boolean;
    } {
        const rateIncrease = plan2.rateLimit - plan1.rateLimit
        const quotaIncrease = plan2.quotaLimit - plan1.quotaLimit

        return {
            rateIncrease,
            quotaIncrease,
            isBetter: rateIncrease > 0 || quotaIncrease > 0
        }
    }

    /**
     * プラン名の表示用フォーマット
     */
    formatPlanName(tier: string): string {
        // Returns a translation key instead of a direct string
        const keyMap: Record<string, string> = {
            'free': 'settings.plan.tierFree',
            'basic': 'settings.plan.tierBasic',
            'pro': 'settings.plan.tierPro'
        }
        return keyMap[tier.toLowerCase()] || 'settings.plan.unknownPlan';
    }

    /**
     * プラン制限の表示用フォーマット
     */
    formatPlanLimits(limits: PlanLimits): { key: string; values: Record<string, any> } {
        const quotaPeriodKey = `settings.plan.quotaPeriod${limits.quotaPeriod.charAt(0).toUpperCase() + limits.quotaPeriod.slice(1).toLowerCase()}`;
        return {
            key: 'settings.plan.limitsPattern',
            values: {
                quotaLimit: limits.quotaLimit === -1 ? 'Unlimited' : limits.quotaLimit.toLocaleString(), // Handle unlimited case
                quotaPeriod: quotaPeriodKey, // This will be a key like 'settings.plan.quotaPeriodDay'
                rateLimit: limits.rateLimit
            }
        };
    }

    /**
     * 接続テスト
     */
    async testConnection(): Promise<any> {
        try {
            console.log('🧪 Testing plan service connection...')
            return await httpClient.get('/plans', {
                requireAuth: true,
                requireApiKey: true
            })
        } catch (error) {
            console.error('🧪 Plan service connection test failed:', error)
            if (error && typeof error === 'object' && 'message' in error) {
                const httpError = error as any
                throw new PlanServiceError(
                    `errors.planService.connectionTestFailed`, // Key
                    httpError.status || 500,
                    'CONNECTION_TEST_FAILED'
                )
            }
            throw new PlanServiceError('errors.planService.connectionTestFailed', 500, 'CONNECTION_TEST_FAILED_UNKNOWN')
        }
    }
}

// シングルトンインスタンス
export const planService = new PlanService()