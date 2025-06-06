// /types/ea-application.ts

/**
 * APIから返される生のEAアプリケーションデータ
 */
export interface EAApplicationRaw {
    id: string;
    userId?: string
    accountNumber: string
    eaName: string
    broker: string
    email: string
    xAccount: string
    status: 'Pending' | 'AwaitingNotification' | 'Active' | 'Expired' | 'Revoked' | 'Rejected' | 'Cancelled'
    appliedAt: string
    updatedAt: string
    notificationScheduledAt?: string
    expiryDate?: string
    licenseKey?: string
}

// === EAApplicationHistory インターフェース ===
export interface EAApplicationHistory {
    userId: string;
    sk: string; // HISTORY#{applicationSK}#{timestamp}
    action: string;
    changedBy: string;
    changedAt: string;
    previousStatus?: ApplicationStatus;
    newStatus?: ApplicationStatus;
    reason?: string;
}

/**
 * UIで使用する正規化されたEAアプリケーションデータ
 */
export interface EAApplication {
    id: string
    accountNumber: string
    eaName: string
    broker: string
    email: string
    xAccount: string
    status: ApplicationStatus
    appliedAt: string
    updatedAt: string
    notificationScheduledAt?: string
    expiryDate?: string
    licenseKey?: string
}

/**
 * アプリケーションステータス（AwaitingNotificationとCancelledを追加）
 */
export type ApplicationStatus = 'Pending' | 'AwaitingNotification' | 'Active' | 'Expired' | 'Revoked' | 'Rejected' | 'Cancelled'

/**
 * アプリケーションアクション
 */
export type ApplicationAction = 'approve' | 'reject' | 'deactivate' | 'cancel'

/**
 * APIレスポンス型
 */
export interface ApiResponse<T = any> {
    items?: T[]
    data?: T
    count?: number
    error?: string
    message?: string
    success?: boolean
}

/**
 * 新しい統一APIレスポンス型
 */
export interface EAApplicationResponse {
    pending: EAApplicationRaw[]
    awaitingNotification: EAApplicationRaw[]
    active: EAApplicationRaw[]
    history: EAApplicationRaw[]
    count: {
        pending: number
        awaitingNotification: number
        active: number
        history: number
        total: number
    }
}

/**
 * ページネーション情報
 */
export interface PaginationInfo {
    currentPage: number
    totalPages: number
    itemsPerPage: number
    totalItems: number
}

/**
 * フィルター条件
 */
export interface ApplicationFilters {
    accountNumber: string
    xAccount: string
    broker: string
    eaName: string
    status?: ApplicationStatus
}

/**
 * ダッシュボード統計情報
 */
export interface DashboardStats {
    pendingCount: number
    activeCount: number
    totalIssued: number
    expiringSoon: number
}

/**
 * UIで使用するアプリケーション表示用データ（notificationScheduledAt復活）
 */
export interface PendingApplicationUI {
    id: string
    accountNumber: string
    broker: string
    eaName: string
    email: string
    xAccount: string
    appliedAt: string
    status: string
    notificationScheduledAt?: string  // カウントダウン用
    updatedAt: string
}

export interface ActiveLicenseUI {
    id: string
    accountNumber: string
    broker: string
    eaName: string
    email: string
    xAccount: string
    licenseKey: string
    activatedAt: string  // updatedAt を使用
    expiryDate: string
    status: string
}

export interface LicenseHistoryUI {
    id: string
    accountNumber: string
    broker: string
    eaName: string
    email: string
    xAccount: string
    licenseKey: string
    issuedAt: string     // appliedAt を使用
    lastUpdatedAt: string // 最終更新日時（updatedAt）
    status: string
    action: string
}

/**
 * エラー型
 */
export interface ServiceError {
    message: string
    code?: string
    status?: number
    details?: any
}