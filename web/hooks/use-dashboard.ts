// hooks/use-dashboard.ts - APIリクエスト重複解消版
'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useEAApplications } from '@/hooks/use-ea-applications'
import { useApplicationLicense } from '@/hooks/use-license'
import { useToast } from '@/hooks/use-toast'
import type {
    EAApplication,
    ApplicationFilters,
    PaginationInfo,
    DashboardStats,
    PendingApplicationUI,
    ActiveLicenseUI,
    LicenseHistoryUI,
    EAApplicationHistory
} from '@/types/ea-application'

export function useDashboard() {
    const { toast } = useToast()

    // === 重複防止用のRef ===
    const initializationRef = useRef({
        isInitializing: false,
        hasInitialized: false
    })

    // === 初期化状態管理（簡素化） ===
    const [initializationState, setInitializationState] = useState<{
        attempted: boolean
        succeeded: boolean
        error: string | null
        retryCount: number
    }>({
        attempted: false,
        succeeded: false,
        error: null,
        retryCount: 0
    })

    // === UI状態 ===
    const [filters, setFilters] = useState<ApplicationFilters>(() => ({
        accountNumber: '',
        xAccount: '',
        broker: '',
        eaName: ''
    }))

    const [pendingPagination, setPendingPagination] = useState<PaginationInfo>(() => ({
        currentPage: 1,
        totalPages: 1,
        itemsPerPage: 10,
        totalItems: 0
    }))

    const [activePagination, setActivePagination] = useState<PaginationInfo>(() => ({
        currentPage: 1,
        totalPages: 1,
        itemsPerPage: 10,
        totalItems: 0
    }))

    const [historyPagination, setHistoryPagination] = useState<PaginationInfo>(() => ({
        currentPage: 1,
        totalPages: 1,
        itemsPerPage: 10,
        totalItems: 0
    }))

    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
    const [isMobile, setIsMobile] = useState(false)

    // === アプリケーション詳細履歴（Timeline）管理ステート ===
    const [selectedApplicationTimeline, setSelectedApplicationTimeline] = useState<EAApplicationHistory[]>([])
    const [timelineLoading, setTimelineLoading] = useState(false)
    const [timelineError, setTimelineError] = useState<string | null>(null)

    // === External Hooks ===
    const eaHook = useEAApplications()
    const licenseHook = useApplicationLicense()

    // === 🔧 重複防止機能付き初期化（クリーンアップ版） ===
    useEffect(() => {
        // 複数の条件で重複防止
        if (initializationRef.current.hasInitialized ||
            initializationRef.current.isInitializing ||
            initializationState.attempted ||
            eaHook.loading) {
            return
        }

        // データが既にある場合は初期化完了とする
        if (eaHook.applications.length > 0) {
            initializationRef.current.hasInitialized = true
            setInitializationState({
                attempted: true,
                succeeded: true,
                error: null,
                retryCount: 0
            })
            return
        }

        const initializeAPI = async () => {
            // 重複防止：再度チェック
            if (initializationRef.current.isInitializing) {
                return
            }

            // 重複防止フラグ設定
            initializationRef.current.isInitializing = true

            setInitializationState(prev => ({
                ...prev,
                attempted: true
            }))

            try {
                await eaHook.loadApplications()

                // 成功時
                initializationRef.current.hasInitialized = true
                setInitializationState({
                    attempted: true,
                    succeeded: true,
                    error: null,
                    retryCount: 0
                })

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                console.error('🚨 Dashboard: API initialization failed:', error)

                setInitializationState({
                    attempted: true,
                    succeeded: false,
                    error: errorMessage,
                    retryCount: 0
                })

                toast({
                    title: "接続エラー",
                    description: `API接続に失敗しました: ${errorMessage}`,
                    variant: "destructive"
                })
            } finally {
                // 初期化フラグをリセット
                initializationRef.current.isInitializing = false
            }
        }

        initializeAPI()

    }, []) // 依存配列は空配列のまま（初回のみ実行）

    // === データが取得された時の処理（分離） ===
    useEffect(() => {
        if (eaHook.applications.length > 0 && !initializationState.succeeded) {
            initializationRef.current.hasInitialized = true
            setInitializationState(prev => ({
                ...prev,
                succeeded: true,
                error: null
            }))

            if (!initializationRef.current.isInitializing) {
                toast({
                    title: "データを読み込みました",
                    description: "EA Applications データが正常に取得されました",
                    variant: "default"
                })
            }
        }
    }, [eaHook.applications.length, initializationState.succeeded, toast])

    // === データ処理とフィルタリング（最適化） ===
    const processedData = useMemo(() => {
        if (!eaHook.applications.length) {
            return {
                filteredApplications: [],
                stats: { pendingCount: 0, activeCount: 0, totalIssued: 0, expiringSoon: 0 },
                pendingUI: [],
                activeUI: [],
                historyUI: []
            }
        }

        // フィルタリング
        const filteredApplications = eaHook.applications.filter(app => {
            return (!filters.accountNumber || app.accountNumber.toLowerCase().includes(filters.accountNumber.toLowerCase())) &&
                (!filters.xAccount || app.xAccount.toLowerCase().includes(filters.xAccount.toLowerCase())) &&
                (!filters.broker || app.broker === filters.broker) &&
                (!filters.eaName || app.eaName.toLowerCase().includes(filters.eaName.toLowerCase()))
        })

        // ステータス別分類
        const pending = filteredApplications.filter(app =>
            app.status === 'Pending' || app.status === 'AwaitingNotification'
        )
        const active = filteredApplications.filter(app => app.status === 'Active')
        const history = filteredApplications.filter(app =>
            ['Expired', 'Revoked', 'Rejected', 'Cancelled'].includes(app.status)
        )

        // UI用データ変換
        const pendingUI: PendingApplicationUI[] = pending.map(app => ({
            id: app.id,
            accountNumber: app.accountNumber,
            broker: app.broker,
            eaName: app.eaName,
            email: app.email,
            xAccount: app.xAccount,
            appliedAt: app.appliedAt,
            status: app.status,
            updatedAt: app.updatedAt,
            notificationScheduledAt: app.notificationScheduledAt
        }))

        const activeUI: ActiveLicenseUI[] = active.map(app => ({
            id: app.id,
            accountNumber: app.accountNumber,
            broker: app.broker,
            eaName: app.eaName,
            email: app.email,
            xAccount: app.xAccount,
            licenseKey: app.licenseKey || '',
            activatedAt: app.updatedAt,
            expiryDate: app.expiryDate || '',
            status: app.status
        }))

        const historyUI: LicenseHistoryUI[] = history.map(app => ({
            id: app.id,
            accountNumber: app.accountNumber,
            broker: app.broker,
            eaName: app.eaName,
            email: app.email,
            xAccount: app.xAccount,
            licenseKey: app.licenseKey || '',
            issuedAt: app.appliedAt,
            lastUpdatedAt: app.updatedAt,
            status: app.status,
            action: app.status
        }))

        // 統計計算
        const now = new Date()
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        const expiringSoon = active.filter(app => {
            if (!app.expiryDate) return false
            const expireDate = new Date(app.expiryDate)
            return expireDate <= thirtyDaysFromNow
        }).length

        const stats: DashboardStats = {
            pendingCount: pending.length,
            activeCount: active.length,
            totalIssued: active.length + history.length,
            expiringSoon
        }

        return {
            filteredApplications,
            stats,
            pendingUI,
            activeUI,
            historyUI
        }
    }, [eaHook.applications, filters])

    // === ページネーション計算（最適化） ===
    const paginatedData = useMemo(() => {
        const { pendingUI, activeUI, historyUI } = processedData

        const getPaginatedItems = <T>(items: T[], pagination: PaginationInfo): T[] => {
            const startIndex = (pagination.currentPage - 1) * pagination.itemsPerPage
            const endIndex = startIndex + pagination.itemsPerPage
            return items.slice(startIndex, endIndex)
        }

        return {
            pending: getPaginatedItems(pendingUI, pendingPagination),
            active: getPaginatedItems(activeUI, activePagination),
            history: getPaginatedItems(historyUI, historyPagination)
        }
    }, [processedData, pendingPagination, activePagination, historyPagination])

    // === ページネーション更新（useCallback最適化） ===
    useEffect(() => {
        const { pendingUI, activeUI, historyUI } = processedData
        const calculateTotalPages = (totalItems: number, itemsPerPage: number) =>
            Math.ceil(totalItems / itemsPerPage) || 1

        // 実際に値が変わった場合のみ更新
        setPendingPagination(prev => {
            const newTotalItems = pendingUI.length
            const newTotalPages = calculateTotalPages(newTotalItems, prev.itemsPerPage)
            if (prev.totalItems !== newTotalItems || prev.totalPages !== newTotalPages) {
                return { ...prev, totalItems: newTotalItems, totalPages: newTotalPages }
            }
            return prev
        })

        setActivePagination(prev => {
            const newTotalItems = activeUI.length
            const newTotalPages = calculateTotalPages(newTotalItems, prev.itemsPerPage)
            if (prev.totalItems !== newTotalItems || prev.totalPages !== newTotalPages) {
                return { ...prev, totalItems: newTotalItems, totalPages: newTotalPages }
            }
            return prev
        })

        setHistoryPagination(prev => {
            const newTotalItems = historyUI.length
            const newTotalPages = calculateTotalPages(newTotalItems, prev.itemsPerPage)
            if (prev.totalItems !== newTotalItems || prev.totalPages !== newTotalPages) {
                return { ...prev, totalItems: newTotalItems, totalPages: newTotalPages }
            }
            return prev
        })
    }, [processedData.pendingUI.length, processedData.activeUI.length, processedData.historyUI.length])

    // === モバイル検出（最適化） ===
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // === Timeline監視（最適化） ===
    useEffect(() => {
        if (eaHook.applicationTimeline.length > 0) {
            setSelectedApplicationTimeline(eaHook.applicationTimeline)
        }
    }, [eaHook.applicationTimeline])

    // === アクション処理（Toast通知付き）===
    const approveApplication = useCallback(async (applicationId: string) => {
        const application = eaHook.applications.find(app => app.id === applicationId)
        if (!application) {
            toast({
                title: "エラー",
                description: "申請が見つかりません",
                variant: "destructive"
            })
            throw new Error('Application not found')
        }

        try {
            const result = await eaHook.approveApplication(
                application.id,
                application.eaName,
                application.accountNumber,
                application.email,
                application.broker,
                '2025-12-31T23:59:59Z'
            )

            toast({
                title: "申請を承認しました",
                description: `${application.eaName} のライセンスが生成されました`,
                variant: "default"
            })

            return result
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast({
                title: "承認に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [eaHook, toast])

    const cancelApplication = useCallback(async (applicationId: string) => {
        const application = eaHook.applications.find(app => app.id === applicationId)
        if (!application) {
            toast({
                title: "エラー",
                description: "申請が見つかりません",
                variant: "destructive"
            })
            throw new Error('Application not found')
        }

        try {
            await eaHook.cancelApplication(application.id)
            toast({
                title: "申請をキャンセルしました",
                description: `${application.eaName} の申請が取り消されました`,
                variant: "default"
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast({
                title: "キャンセルに失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [eaHook, toast])

    const rejectApplication = useCallback(async (applicationId: string) => {
        const application = eaHook.applications.find(app => app.id === applicationId)
        if (!application) {
            toast({
                title: "エラー",
                description: "申請が見つかりません",
                variant: "destructive"
            })
            throw new Error('Application not found')
        }

        try {
            await eaHook.rejectApplication(application.id)
            toast({
                title: "申請を拒否しました",
                description: `${application.eaName} の申請が拒否されました`,
                variant: "default"
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast({
                title: "拒否に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [eaHook, toast])

    const deactivateApplication = useCallback(async (applicationId: string) => {
        const application = eaHook.applications.find(app => app.id === applicationId)
        if (!application) {
            toast({
                title: "エラー",
                description: "申請が見つかりません",
                variant: "destructive"
            })
            throw new Error('Application not found')
        }

        try {
            await licenseHook.revokeLicense(application.id)
            await eaHook.loadApplications()

            toast({
                title: "ライセンスを無効化しました",
                description: `${application.eaName} のライセンスが無効化されました`,
                variant: "default"
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast({
                title: "無効化に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [eaHook, licenseHook, toast])

    const decryptLicense = useCallback(async (applicationId: string) => {
        try {
            const result = await licenseHook.decryptLicense(applicationId)
            toast({
                title: "ライセンスを復号化しました",
                description: "ライセンスキーが表示されます",
                variant: "default"
            })
            return result
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast({
                title: "復号化に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [licenseHook, toast])

    const loadApplicationTimeline = useCallback(async (applicationId: string) => {
        setTimelineLoading(true)
        setTimelineError(null)
        setSelectedApplicationTimeline([])

        try {
            await eaHook.loadApplicationTimeline(applicationId)

            toast({
                title: "変更履歴を取得しました",
                description: "アプリケーションの詳細履歴が正常に読み込まれました",
                variant: "default"
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            setTimelineError(errorMessage)

            toast({
                title: "履歴取得に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        } finally {
            setTimelineLoading(false)
        }
    }, [eaHook, toast])

    const clearApplicationTimeline = useCallback(() => {
        setSelectedApplicationTimeline([])
        setTimelineError(null)
    }, [])

    // === 統合された更新機能（クリーンアップ版） ===
    const refreshData = useCallback(async () => {
        // 既に読み込み中の場合はスキップ
        if (eaHook.loading) {
            return
        }

        // エラー状態の場合は初期化状態をリセット
        if (initializationState.error) {
            initializationRef.current.hasInitialized = false
            setInitializationState({
                attempted: false,
                succeeded: false,
                error: null,
                retryCount: initializationState.retryCount + 1
            })
        }

        try {
            await eaHook.loadApplications()

            setInitializationState(prev => ({
                attempted: true,
                succeeded: true,
                error: null,
                retryCount: prev.retryCount
            }))

            toast({
                title: initializationState.error ? "接続が復旧しました" : "データを更新しました",
                description: "最新の情報を取得しました",
                variant: "default"
            })
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'

            setInitializationState(prev => ({
                attempted: true,
                succeeded: false,
                error: errorMessage,
                retryCount: prev.retryCount
            }))

            toast({
                title: initializationState.error ? "再接続に失敗しました" : "更新に失敗しました",
                description: errorMessage,
                variant: "destructive"
            })
            throw error
        }
    }, [eaHook.loadApplications, eaHook.loading, toast, initializationState])

    // === フィルター操作（最適化） ===
    const updateFilter = useCallback((key: keyof ApplicationFilters, value: string) => {
        setFilters(prev => {
            if (prev[key] === value) return prev
            return { ...prev, [key]: value }
        })

        setPendingPagination(prev => prev.currentPage === 1 ? prev : { ...prev, currentPage: 1 })
        setActivePagination(prev => prev.currentPage === 1 ? prev : { ...prev, currentPage: 1 })
        setHistoryPagination(prev => prev.currentPage === 1 ? prev : { ...prev, currentPage: 1 })
    }, [])

    const clearFilters = useCallback(() => {
        setFilters(prev => {
            if (Object.values(prev).every(v => v === '')) return prev
            return { accountNumber: '', xAccount: '', broker: '', eaName: '' }
        })
    }, [])

    const hasActiveFilters = useMemo(() => {
        return Object.values(filters).some(value => value !== '')
    }, [filters])

    // === ページネーション操作（最適化） ===
    const updatePendingPage = useCallback((page: number) => {
        setPendingPagination(prev => prev.currentPage === page ? prev : { ...prev, currentPage: page })
    }, [])

    const updateActivePage = useCallback((page: number) => {
        setActivePagination(prev => prev.currentPage === page ? prev : { ...prev, currentPage: page })
    }, [])

    const updateHistoryPage = useCallback((page: number) => {
        setHistoryPagination(prev => prev.currentPage === page ? prev : { ...prev, currentPage: page })
    }, [])

    // === ブローカー一覧（最適化） ===
    const brokers = useMemo(() => {
        return Array.from(new Set(eaHook.applications.map(app => app.broker))).sort()
    }, [eaHook.applications])

    // === 戻り値（最適化） ===
    return useMemo(() => ({
        data: {
            applications: processedData.filteredApplications,
            stats: processedData.stats,
            brokers,
            pending: paginatedData.pending,
            active: paginatedData.active,
            history: paginatedData.history,
            selectedApplicationTimeline,
        },

        state: {
            loading: eaHook.loading || licenseHook.isDecrypting || licenseHook.isRevoking,
            error: initializationState.error || eaHook.error || licenseHook.decryptError || licenseHook.revokeError,
            filters,
            showAdvancedFilters,
            isMobile,
            hasActiveFilters,
            pendingPagination,
            activePagination,
            historyPagination,
            initialization: initializationState,
            timelineLoading,
            timelineError,
        },

        actions: {
            loadApplications: refreshData,
            approveApplication,
            cancelApplication,
            rejectApplication,
            deactivateApplication,
            decryptLicense,
            updateFilter,
            clearFilters,
            setShowAdvancedFilters,
            updatePendingPage,
            updateActivePage,
            updateHistoryPage,
            clearError: () => setInitializationState(prev => ({ ...prev, error: null })),
            loadApplicationTimeline,
            clearApplicationTimeline,
        },

        meta: {
            lastUpdated: eaHook.lastUpdated,
            isApproving: eaHook.isApproving,
            isCanceling: eaHook.isCanceling,
            isRejecting: eaHook.isRejecting,
            isDeactivating: eaHook.isDeactivating || licenseHook.isRevoking,
            isDecrypting: licenseHook.isDecrypting,
            retry: eaHook.retry,
            canRetry: initializationState.error !== null,
            hasApplicationTimeline: selectedApplicationTimeline.length > 0,
            licenseDecryptedData: licenseHook.decryptedLicense,
            licenseDecryptError: licenseHook.decryptError,
            licenseRevokeError: licenseHook.revokeError
        }
    }), [
        processedData,
        brokers,
        paginatedData,
        eaHook,
        licenseHook,
        initializationState,
        filters,
        showAdvancedFilters,
        isMobile,
        hasActiveFilters,
        pendingPagination,
        activePagination,
        historyPagination,
        refreshData,
        approveApplication,
        cancelApplication,
        rejectApplication,
        deactivateApplication,
        decryptLicense,
        updateFilter,
        clearFilters,
        setShowAdvancedFilters,
        updatePendingPage,
        updateActivePage,
        updateHistoryPage,
        selectedApplicationTimeline,
        timelineLoading,
        timelineError,
        loadApplicationTimeline,
        clearApplicationTimeline
    ])
}