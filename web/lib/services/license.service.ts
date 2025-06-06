import { httpClient } from "@/lib/http-client"

/**
 * ライセンス固有エラー
 */
export class LicenseServiceError extends Error {
    constructor(
        message: string,
        public status: number = 500,
        public code?: string
    ) {
        super(message)
        this.name = 'LicenseServiceError'
    }
}

/**
 * ライセンス関連の型定義
 */
export interface LicensePayloadV1 {
    version: "v1"
    eaName: string
    accountId: string
    expiry: string
    userId: string
    issuedAt: string
}

export interface EncryptLicenseRequest {
    eaName: string
    accountId: string
    expiry: string
}

export interface DecryptLicenseRequest {
    encryptedLicense: string
    accountId: string
}

export interface LicenseApiResponse<T = any> {
    success: boolean
    message: string
    timestamp: string
    data?: T
}

export interface EncryptLicenseResponse {
    encryptedLicense: string
}

export interface DecryptLicenseResponse {
    decryptedLicense: LicensePayloadV1
}

/**
 * ライセンス専用サービス
 * HttpClientを使用してライセンス関連APIと通信
 */
export class LicenseService {
    /**
     * ライセンス暗号化（新規）
     * Playground UI用のライセンス生成機能
     */
    async encryptLicense(request: EncryptLicenseRequest): Promise<EncryptLicenseResponse> {
        try {
            const response = await httpClient.post<LicenseApiResponse<EncryptLicenseResponse>>(
                '/licenses/encrypt',
                request
            )

            if (!response.success || !response.data) {
                throw new LicenseServiceError(
                    response.message || 'Failed to encrypt license',
                    500
                )
            }

            return response.data
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new LicenseServiceError(
                    `Failed to encrypt license: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new LicenseServiceError('Failed to encrypt license')
        }
    }

    /**
     * 任意ライセンス復号化（新規）
     * Playground UI用の任意ライセンス文字列復号化
     */
    async decryptLicense(request: DecryptLicenseRequest): Promise<DecryptLicenseResponse> {
        try {
            const response = await httpClient.post<LicenseApiResponse<DecryptLicenseResponse>>(
                '/licenses/decrypt',
                request
            )

            if (!response.success || !response.data) {
                throw new LicenseServiceError(
                    response.message || 'Failed to decrypt license',
                    500
                )
            }

            return response.data
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new LicenseServiceError(
                    `Failed to decrypt license: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new LicenseServiceError('Failed to decrypt license')
        }
    }

    /**
     * アプリケーション指定ライセンス復号化（移動）
     * 既存のダッシュボード機能用
     */
    async decryptApplicationLicense(applicationId: string): Promise<{ decryptedKey: string }> {
        try {
            const encodedId = encodeURIComponent(applicationId)
            const response = await httpClient.post<LicenseApiResponse<DecryptLicenseResponse>>(
                `/licenses/${encodedId}/decrypt`
            )

            if (!response.success || !response.data) {
                throw new LicenseServiceError(
                    response.message || 'Failed to decrypt application license',
                    500
                )
            }

            // レスポンス構造に合わせて変換（既存コードとの互換性保持）
            return {
                decryptedKey: JSON.stringify(response.data.decryptedLicense, null, 2)
            }
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new LicenseServiceError(
                    `Failed to decrypt application license: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new LicenseServiceError('Failed to decrypt application license')
        }
    }

    /**
     * ライセンス無効化（移動）
     * 既存のダッシュボード機能用
     */
    async revokeLicense(applicationId: string, reason?: string): Promise<void> {
        try {
            const encodedId = encodeURIComponent(applicationId)
            const requestBody = reason ? { reason } : undefined

            const response = await httpClient.post<LicenseApiResponse>(
                `/licenses/${encodedId}/revoke`,
                requestBody
            )

            if (!response.success) {
                throw new LicenseServiceError(
                    response.message || 'Failed to revoke license',
                    500
                )
            }
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                const httpError = error as any
                throw new LicenseServiceError(
                    `Failed to revoke license: ${httpError.message}`,
                    httpError.status
                )
            }
            throw new LicenseServiceError('Failed to revoke license')
        }
    }

    /**
     * ライセンス有効性チェック
     * ユーティリティ機能
     */
    isLicenseExpired(license: LicensePayloadV1): boolean {
        try {
            const expiryDate = new Date(license.expiry)
            const now = new Date()
            return expiryDate <= now
        } catch (error) {
            return true // パース失敗時は期限切れとして扱う
        }
    }

    /**
     * ライセンス期限切れ日数計算
     * ユーティリティ機能
     */
    getDaysUntilExpiry(license: LicensePayloadV1): number {
        try {
            const expiryDate = new Date(license.expiry)
            const now = new Date()
            const diffTime = expiryDate.getTime() - now.getTime()
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
            return diffDays
        } catch (error) {
            return -1 // パース失敗時は期限切れとして扱う
        }
    }

    /**
     * ライセンスペイロード検証
     * ユーティリティ機能
     */
    validateLicensePayload(payload: any): payload is LicensePayloadV1 {
        return (
            typeof payload === 'object' &&
            payload !== null &&
            payload.version === 'v1' &&
            typeof payload.eaName === 'string' &&
            typeof payload.accountId === 'string' &&
            typeof payload.expiry === 'string' &&
            typeof payload.userId === 'string' &&
            typeof payload.issuedAt === 'string'
        )
    }
}

// シングルトンインスタンス
export const licenseService = new LicenseService()