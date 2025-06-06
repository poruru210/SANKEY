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
                    `Failed to get plan information: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new PlanServiceError('Failed to get plan information')
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
                    `Failed to change plan: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new PlanServiceError('Failed to change plan')
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
        const formatMap: Record<string, string> = {
            'free': 'Free Plan',
            'basic': 'Basic Plan',
            'pro': 'Pro Plan'
        }

        return formatMap[tier] || tier
    }

    /**
     * プラン制限の表示用フォーマット
     */
    formatPlanLimits(limits: PlanLimits): string {
        return `${limits.quotaLimit} requests/${limits.quotaPeriod.toLowerCase()}, ${limits.rateLimit} req/sec`
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
                    `Plan service connection test failed: ${httpError.message}`,
                    httpError.status || 500
                )
            }
            throw new PlanServiceError('Plan service connection test failed')
        }
    }
}

// シングルトンインスタンス
export const planService = new PlanService()