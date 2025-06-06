import { httpClient } from "@/lib/http-client"
import type {
    EAApplicationRaw,
    EAApplication,
    DashboardStats,
    PendingApplicationUI,
    ActiveLicenseUI,
    LicenseHistoryUI,
    EAApplicationHistory
} from '@/types/ea-application'

/**
 * EA Application固有エラー
 */
export class EAApplicationError extends Error {
    constructor(
        message: string,
        public status: number = 500,
        public code?: string
    ) {
        super(message)
        this.name = 'EAApplicationError'
    }
}

/**
 * EA Application Service
 * HttpClientを使用してAPIと通信し、ビジネスロジックを提供
 * ライセンス関連機能は license.service に移譲
 */
export class EAApplicationService {
    /**
     * 生データを正規化されたオブジェクトに変換
     */
    private normalizeApplication(raw: EAApplicationRaw): EAApplication {
        return {
            id: raw.id,
            accountNumber: raw.accountNumber,
            eaName: raw.eaName,
            broker: raw.broker,
            email: raw.email,
            xAccount: raw.xAccount,
            status: raw.status,
            appliedAt: raw.appliedAt,
            notificationScheduledAt: raw.notificationScheduledAt,
            licenseKey: raw.licenseKey,
            expiryDate: raw.expiryDate,
            updatedAt: raw.updatedAt
        }
    }

    /**
     * EA申請一覧取得
     */
    async getApplications(): Promise<EAApplication[]> {
        try {
            const response = await httpClient.get<any>('/applications')

            const { pending = [], awaitingNotification = [], active = [], history = [] } = response.data

            const rawApplications: EAApplicationRaw[] = [
                ...pending,
                ...awaitingNotification,
                ...active,
                ...history
            ]

            return rawApplications.map(raw => this.normalizeApplication(raw))
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new EAApplicationError(
                    `Failed to load applications: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new EAApplicationError('Failed to load applications')
        }
    }

    /**
     * アプリケーション承認（ライセンス生成）
     */
    async approveApplication(
        applicationId: string,
        eaName: string,
        accountId: string,
        email: string,
        broker: string,
        expiresAt: string = '2025-12-31T23:59:59Z'
    ) {
        try {
            const requestBody = {
                eaName,
                accountId,
                expiry: expiresAt,
                email,
                broker
            }

            const encodedId = encodeURIComponent(applicationId);
            return await httpClient.post(`/applications/${encodedId}/approve`, requestBody)
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new EAApplicationError(
                    `Failed to approve application: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new EAApplicationError('Failed to approve application')
        }
    }

    /**
     * アプリケーション履歴取得
     */
    async getApplicationHistories(
        applicationId: string
    ): Promise<EAApplicationHistory[]> {
        try {
            const encodedId = encodeURIComponent(applicationId);
            const response = await httpClient.get<{
                success: boolean;
                message: string;
                data: {
                    id: string;
                    histories: EAApplicationHistory[];
                }
            }>(`/applications/${encodedId}/histories`);

            // API レスポンスから履歴データを抽出
            const histories = response.data?.histories || [];

            // 時系列順（新しい順）でソート（念のため）
            const sortedHistories = histories.sort((a, b) =>
                new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
            );

            return sortedHistories;

        } catch (error) {
            console.error('Failed to load application histories:', error);

            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any;
                throw new EAApplicationError(
                    `Failed to load application histories: ${httpError.message}`,
                    httpError.status
                );
            }
            throw new EAApplicationError('Failed to load application histories');
        }
    }
    
    
    /**
     * アプリケーションキャンセル（5分以内の取り消し）
     */
    async cancelApplication(applicationId: string): Promise<void> {
        try {
            const encodedId = encodeURIComponent(applicationId)
            await httpClient.post(`/applications/${encodedId}/cancel`)
        } catch (error) {
            if (error && typeof error === 'object' && 'message' in error) {
                const httpError = error as any
                throw new EAApplicationError(
                    `Failed to cancel application: ${httpError.message}`,
                    httpError.status || 500
                )
            }
            throw new EAApplicationError('Failed to cancel application')
        }
    }

    /**
     * アプリケーション拒否
     */
    async rejectApplication(applicationId: string): Promise<void> {
        try {
            const encodedId = encodeURIComponent(applicationId)
            await httpClient.post(`/applications/${encodedId}/reject`)
        } catch (error) {
            if (error && typeof error === 'object' && 'message' in error) {
                const httpError = error as any
                throw new EAApplicationError(
                    `Failed to reject application: ${httpError.message}`,
                    httpError.status || 500
                )
            }
            throw new EAApplicationError('Failed to reject application')
        }
    }

    /**
     * アプリケーション無効化
     * 注意: ライセンス無効化機能は license.service に移譲されました
     * このメソッドは互換性のために残されていますが、
     * 新しいコードでは licenseService.revokeLicense() を直接使用してください
     */
    async deactivateApplication(applicationId: string, reason?: string): Promise<void> {
        console.warn('⚠️  deactivateApplication is deprecated. Use licenseService.revokeLicense() instead.')

        try {
            const encodedId = encodeURIComponent(applicationId)
            const requestBody = reason ? { reason } : undefined

            await httpClient.post(`/licenses/${encodedId}/revoke`, requestBody)
        } catch (error) {
            if (error && typeof error === 'object' && 'message' in error) {
                const httpError = error as any
                throw new EAApplicationError(
                    `Failed to deactivate application: ${httpError.message}`,
                    httpError.status || 500
                )
            }
            throw new EAApplicationError('Failed to deactivate application')
        }
    }

    /**
     * アプリケーションキー生成
     */
    generateApplicationKey(application: EAApplication): string {
        return application.id || `${application.appliedAt}#${application.accountNumber}`
    }

    /**
     * アプリケーションをステータス別に分類
     */
    categorizeApplications(applications: EAApplication[]) {
        const pending = applications.filter(app =>
            app.status === 'Pending' || app.status === 'AwaitingNotification'
        )
        const active = applications.filter(app => app.status === 'Active')
        const history = applications.filter(app =>
            ['Expired', 'Revoked', 'Rejected', 'Cancelled'].includes(app.status)
        )

        return { pending, active, history }
    }

    /**
     * ダッシュボード統計計算
     */
    calculateStats(applications: EAApplication[]): DashboardStats {
        const { pending, active, history } = this.categorizeApplications(applications)

        // 期限切れ間近のライセンス数計算（30日以内）
        const now = new Date()
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

        const expiringSoon = active.filter(app => {
            if (!app.expiryDate) return false
            const expireDate = new Date(app.expiryDate)
            return expireDate <= thirtyDaysFromNow
        }).length

        return {
            pendingCount: pending.length,
            activeCount: active.length,
            totalIssued: active.length + history.length,
            expiringSoon
        }
    }

    /**
     * UI用のデータ変換
     */
    transformToUIData(applications: EAApplication[]) {

        const { pending, active, history } = this.categorizeApplications(applications)

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
            activatedAt: app.updatedAt, // updatedAt をライセンス有効化日時として使用
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
            issuedAt: app.appliedAt, // 申請日時を発行日時として使用
            lastUpdatedAt: app.updatedAt, // 最終更新日時
            status: app.status,
            action: app.status
        }))

        return { pendingUI, activeUI, historyUI }
    }

    /**
     * ブローカー一覧取得
     */
    getBrokers(applications: EAApplication[]): string[] {
        const brokers = new Set(applications.map(app => app.broker))
        return Array.from(brokers).sort()
    }
}

// シングルトンインスタンス
export const eaApplicationService = new EAApplicationService()