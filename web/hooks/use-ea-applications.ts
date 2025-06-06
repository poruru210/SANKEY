'use client'

import { useState, useCallback, useEffect } from 'react'
import { useApi, useMultipleApi } from './use-api'
import { eaApplicationService, EAApplicationError } from '@/lib/services/ea-application.service'
import type {
    EAApplication,
    DashboardStats,
    PendingApplicationUI,
    ActiveLicenseUI,
    LicenseHistoryUI,
    EAApplicationHistory // ✅ Timeline用の型を追加
} from '@/types/ea-application'

/**
 * EA Applications管理Hook（ライセンス機能分離版）
 * 一覧取得、更新、統計計算を管理
 * ライセンス関連機能はuse-licenseに移譲
 */
export function useEAApplications() {
    const [applications, setApplications] = useState<EAApplication[]>([])
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

    // ✅ Timeline管理ステート（新規追加）
    const [applicationTimeline, setApplicationTimeline] = useState<EAApplicationHistory[]>([])
    const [timelineLoading, setTimelineLoading] = useState(false)
    const [timelineError, setTimelineError] = useState<Error | null>(null)

    // API状態管理
    const {
        data: loadData,
        loading: listLoading,
        error: listError,
        execute: executeList,
        retry: retryList
    } = useApi<EAApplication[]>()

    const multiApi = useMultipleApi<{
        approve: any
        cancel: void
        reject: void
        deactivate: void
    }>()

    /**
     * アプリケーション一覧読み込み
     */
    const loadApplications = useCallback(async () => {
        try {
            const result = await executeList(() => eaApplicationService.getApplications())
            if (result) {
                setApplications(result)
                setLastUpdated(new Date())
            }
            return result
        } catch (error) {
            console.error('Failed to load applications:', error)
            throw error
        }
    }, [executeList])

    /**
     * アプリケーション承認
     */
    const approveApplication = useCallback(async (
        applicationId: string,
        eaName: string,
        accountId: string,
        email: string,
        broker: string,
        expiresAt?: string
    ) => {
        try {
            const result = await multiApi.execute('approve', () =>
                eaApplicationService.approveApplication(
                    applicationId, eaName, accountId, email, broker, expiresAt
                )
            )

            // 成功後にリストを再読み込み
            if (result) {
                await loadApplications()
            }

            return result
        } catch (error) {
            console.error('Failed to approve application:', error)
            throw error
        }
    }, [multiApi, loadApplications])

    /**
     * アプリケーションキャンセル
     */
    const cancelApplication = useCallback(async (applicationId: string) => {
        try {
            await multiApi.execute('cancel', () =>
                eaApplicationService.cancelApplication(applicationId)
            )

            // 成功後にリストを再読み込み
            await loadApplications()
        } catch (error) {
            console.error('Failed to cancel application:', error)
            throw error
        }
    }, [multiApi, loadApplications])

    /**
     * アプリケーション拒否
     */
    const rejectApplication = useCallback(async (applicationId: string) => {
        try {
            await multiApi.execute('reject', () =>
                eaApplicationService.rejectApplication(applicationId)
            )

            // 成功後にリストを再読み込み
            await loadApplications()
        } catch (error) {
            console.error('Failed to reject application:', error)
            throw error
        }
    }, [multiApi, loadApplications])

    /**
     * アプリケーション無効化（ライセンス無効化）
     * 注意: この機能は新しいuse-licenseのrevokeLicenseと連携する必要があります
     */
    const deactivateApplication = useCallback(async (applicationId: string, reason?: string) => {
        try {
            // 注意: この実装は暫定的です
            // 実際には、ライセンス無効化後にアプリケーション状態を更新する必要があります
            await multiApi.execute('deactivate', () =>
                eaApplicationService.deactivateApplication(applicationId, reason)
            )

            // 成功後にリストを再読み込み
            await loadApplications()
        } catch (error) {
            console.error('Failed to deactivate application:', error)
            throw error
        }
    }, [multiApi, loadApplications])

    // ✅ Timeline取得関数（新規追加）
    const loadApplicationTimeline = useCallback(async (applicationId: string) => {
        setTimelineLoading(true)
        setTimelineError(null)
        try {
            const result = await eaApplicationService.getApplicationHistories(applicationId)
            setApplicationTimeline(result)
        } catch (error) {
            console.error('Failed to load application timeline:', error)
            setTimelineError(error as Error)
        } finally {
            setTimelineLoading(false)
        }
    }, [])

    // ✅ Timeline クリア関数（新規追加）
    const clearApplicationTimeline = useCallback(() => {
        setApplicationTimeline([])
        setTimelineError(null)
    }, [])

    // 計算されたデータ
    const stats: DashboardStats = eaApplicationService.calculateStats(applications)
    const { pendingUI, activeUI, historyUI } = eaApplicationService.transformToUIData(applications)
    const brokers = eaApplicationService.getBrokers(applications)

    // 統合ローディング状態
    const loading = listLoading ||
        multiApi.isLoading('approve') ||
        multiApi.isLoading('cancel') ||
        multiApi.isLoading('reject') ||
        multiApi.isLoading('deactivate')

    // 統合エラー状態
    const error = listError ||
        multiApi.getState('approve').error ||
        multiApi.getState('cancel').error ||
        multiApi.getState('reject').error ||
        multiApi.getState('deactivate').error

    return {
        // データ
        applications,
        stats,
        pendingApplications: pendingUI,
        activeApplications: activeUI,
        historyApplications: historyUI,
        brokers,
        lastUpdated,

        // 状態
        loading,
        error,

        // アクション
        loadApplications,
        approveApplication,
        cancelApplication,
        rejectApplication,
        deactivateApplication,

        // ユーティリティ
        retry: retryList,
        isApproving: multiApi.isLoading('approve'),
        isCanceling: multiApi.isLoading('cancel'),
        isRejecting: multiApi.isLoading('reject'),
        isDeactivating: multiApi.isLoading('deactivate'),

        // 個別エラー取得
        getApproveError: () => multiApi.getState('approve').error,
        getCancelError: () => multiApi.getState('cancel').error,
        getRejectError: () => multiApi.getState('reject').error,
        getDeactivateError: () => multiApi.getState('deactivate').error,

        // ✅ Timeline機能（新規追加）
        loadApplicationTimeline,
        applicationTimeline,
        timelineLoading,
        timelineError,
        clearApplicationTimeline,
    }
}

/**
 * EA Application統計専用Hook（軽量版）
 */
export function useEAStats() {
    const { data, loading, error, execute } = useApi<DashboardStats>()

    const loadStats = useCallback(async () => {
        return execute(async () => {
            const applications = await eaApplicationService.getApplications()
            return eaApplicationService.calculateStats(applications)
        })
    }, [execute])

    return {
        stats: data,
        loading,
        error,
        loadStats
    }
}

/**
 * リアルタイム更新Hook（ポーリング機能付き）
 */
export function useEAApplicationsWithPolling(intervalMs: number = 30000) {
    const eaHook = useEAApplications()
    const [isPolling, setIsPolling] = useState(false)

    useEffect(() => {
        if (!isPolling) return

        const interval = setInterval(() => {
            if (!eaHook.loading) {
                eaHook.loadApplications().catch(console.error)
            }
        }, intervalMs)

        return () => clearInterval(interval)
    }, [isPolling, intervalMs, eaHook])

    const startPolling = useCallback(() => {
        setIsPolling(true)
        // 初回読み込み
        if (!eaHook.loading && eaHook.applications.length === 0) {
            eaHook.loadApplications().catch(console.error)
        }
    }, [eaHook])

    const stopPolling = useCallback(() => {
        setIsPolling(false)
    }, [])

    return {
        ...eaHook,
        isPolling,
        startPolling,
        stopPolling
    }
}

/**
 * EA Application操作履歴Hook
 */
export function useEAApplicationHistory() {
    const [history, setHistory] = useState<Array<{
        action: string
        applicationKey: string
        timestamp: Date
        success: boolean
        error?: string
    }>>([])

    const addHistoryEntry = useCallback((
        action: string,
        applicationKey: string,
        success: boolean,
        error?: string
    ) => {
        setHistory(prev => [{
            action,
            applicationKey,
            timestamp: new Date(),
            success,
            error
        }, ...prev.slice(0, 99)]) // 最新100件まで保持
    }, [])

    const clearHistory = useCallback(() => {
        setHistory([])
    }, [])

    return {
        history,
        addHistoryEntry,
        clearHistory
    }
}