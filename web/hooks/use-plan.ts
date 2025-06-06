import { useState, useCallback } from 'react'
import {
    planService,
    PlanService,
    PlanServiceError,
    PlanInfo,
    PlanTier,
    ChangePlanResponse
} from '@/lib/services/plan.service'

interface UsePlanState {
    planInfo: PlanInfo | null
    isLoading: boolean
    error: string | null
}

interface UsePlanActions {
    getPlanInfo: () => Promise<void>
    changePlan: (newTier: PlanTier, userId?: string) => Promise<ChangePlanResponse | null>
    testConnection: () => Promise<void>
    clearError: () => void
    canUpgrade: () => boolean
    canDowngrade: () => boolean
    getUpgradeOptions: () => PlanTier[]
    getDowngradeOptions: () => PlanTier[]
    formatPlanName: (tier: string) => string
    formatPlanLimits: (limits: any) => string
}

export interface UsePlan extends UsePlanState, UsePlanActions {}

/**
 * Plan管理用のReactフック
 * プラン情報の取得、変更、ユーティリティ機能を提供
 */
export function usePlan(): UsePlan {
    const [state, setState] = useState<UsePlanState>({
        planInfo: null,
        isLoading: false,
        error: null,
    })

    // エラーをクリア
    const clearError = useCallback(() => {
        setState(prev => ({ ...prev, error: null }))
    }, [])

    // プラン情報取得
    const getPlanInfo = useCallback(async () => {
        try {
            setState(prev => ({ ...prev, isLoading: true, error: null }))

            const planInfo = await planService.getPlanInfo()

            setState(prev => ({
                ...prev,
                planInfo,
                isLoading: false,
            }))
        } catch (error) {
            const errorMessage = error instanceof PlanServiceError
                ? error.message
                : 'Failed to load plan information'

            setState(prev => ({
                ...prev,
                isLoading: false,
                error: errorMessage,
            }))

            console.error('Failed to get plan info:', error)
        }
    }, [])

    // プラン変更
    const changePlan = useCallback(async (newTier: PlanTier, userId?: string): Promise<ChangePlanResponse | null> => {
        try {
            setState(prev => ({ ...prev, isLoading: true, error: null }))

            const result = await planService.changePlan(newTier, userId)

            // プラン変更後、最新の情報を再取得
            await getPlanInfo()

            setState(prev => ({ ...prev, isLoading: false }))

            return result
        } catch (error) {
            const errorMessage = error instanceof PlanServiceError
                ? error.message
                : 'Failed to change plan'

            setState(prev => ({
                ...prev,
                isLoading: false,
                error: errorMessage,
            }))

            console.error('Failed to change plan:', error)
            return null
        }
    }, [getPlanInfo])

    // 接続テスト
    const testConnection = useCallback(async () => {
        try {
            setState(prev => ({ ...prev, isLoading: true, error: null }))

            await planService.testConnection()

            setState(prev => ({ ...prev, isLoading: false }))

            console.log('✅ Plan service connection test successful')
        } catch (error) {
            const errorMessage = error instanceof PlanServiceError
                ? error.message
                : 'Plan service connection test failed'

            setState(prev => ({
                ...prev,
                isLoading: false,
                error: errorMessage,
            }))

            console.error('❌ Plan service connection test failed:', error)
        }
    }, [])

    // ユーティリティ関数（プラン情報に基づく）
    const canUpgrade = useCallback(() => {
        if (!state.planInfo) return false
        return planService.canUpgrade(state.planInfo.current.currentTier)
    }, [state.planInfo])

    const canDowngrade = useCallback(() => {
        if (!state.planInfo) return false
        return planService.canDowngrade(state.planInfo.current.currentTier)
    }, [state.planInfo])

    const getUpgradeOptions = useCallback(() => {
        if (!state.planInfo) return []
        return planService.getUpgradeOptions(state.planInfo.current.currentTier)
    }, [state.planInfo])

    const getDowngradeOptions = useCallback(() => {
        if (!state.planInfo) return []
        return planService.getDowngradeOptions(state.planInfo.current.currentTier)
    }, [state.planInfo])

    // 表示用フォーマット関数
    const formatPlanName = useCallback((tier: string) => {
        return planService.formatPlanName(tier)
    }, [])

    const formatPlanLimits = useCallback((limits: any) => {
        return planService.formatPlanLimits(limits)
    }, [])

    return {
        // State
        planInfo: state.planInfo,
        isLoading: state.isLoading,
        error: state.error,

        // Actions
        getPlanInfo,
        changePlan,
        testConnection,
        clearError,

        // Utilities
        canUpgrade,
        canDowngrade,
        getUpgradeOptions,
        getDowngradeOptions,
        formatPlanName,
        formatPlanLimits,
    }
}

/**
 * プラン情報のみを取得する軽量フック
 */
export function usePlanInfo() {
    const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchPlanInfo = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)

            const info = await planService.getPlanInfo()
            setPlanInfo(info)
        } catch (error) {
            const errorMessage = error instanceof PlanServiceError
                ? error.message
                : 'Failed to load plan information'
            setError(errorMessage)
        } finally {
            setIsLoading(false)
        }
    }, [])

    return {
        planInfo,
        isLoading,
        error,
        refetch: fetchPlanInfo,
    }
}