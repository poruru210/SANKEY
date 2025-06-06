// hooks/use-license.ts - ライセンス専用Hook
'use client'

import { useCallback } from 'react'
import { useApi, useMultipleApi } from './use-api'
import {
    licenseService,
    LicenseServiceError,
    type EncryptLicenseRequest,
    type DecryptLicenseRequest,
    type EncryptLicenseResponse,
    type DecryptLicenseResponse
} from '@/lib/services/license.service'

/**
 * ライセンス管理Hook
 * 暗号化、復号化、無効化機能を提供
 */
export function useLicense() {
    // 複数のAPI操作を管理
    const multiApi = useMultipleApi<{
        encrypt: EncryptLicenseResponse
        decrypt: DecryptLicenseResponse
        decryptApplication: { decryptedKey: string }
        revoke: void
    }>()

    /**
     * ライセンス暗号化（Playground用）
     */
    const encryptLicense = useCallback(async (request: EncryptLicenseRequest) => {
        try {
            const result = await multiApi.execute('encrypt', () =>
                licenseService.encryptLicense(request)
            )
            return result
        } catch (error) {
            console.error('Failed to encrypt license:', error)
            throw error
        }
    }, [multiApi])

    /**
     * 任意ライセンス復号化（Playground用）
     */
    const decryptLicense = useCallback(async (request: DecryptLicenseRequest) => {
        try {
            const result = await multiApi.execute('decrypt', () =>
                licenseService.decryptLicense(request)
            )
            return result
        } catch (error) {
            console.error('Failed to decrypt license:', error)
            throw error
        }
    }, [multiApi])

    /**
     * アプリケーション指定ライセンス復号化（ダッシュボード用）
     */
    const decryptApplicationLicense = useCallback(async (applicationId: string) => {
        try {
            const result = await multiApi.execute('decryptApplication', () =>
                licenseService.decryptApplicationLicense(applicationId)
            )
            return result
        } catch (error) {
            console.error('Failed to decrypt application license:', error)
            throw error
        }
    }, [multiApi])

    /**
     * ライセンス無効化（ダッシュボード用）
     */
    const revokeLicense = useCallback(async (applicationId: string, reason?: string) => {
        try {
            await multiApi.execute('revoke', () =>
                licenseService.revokeLicense(applicationId, reason)
            )
        } catch (error) {
            console.error('Failed to revoke license:', error)
            throw error
        }
    }, [multiApi])

    return {
        // データ
        encryptedLicense: multiApi.getState('encrypt').data,
        decryptedLicense: multiApi.getState('decrypt').data,
        decryptedApplicationLicense: multiApi.getState('decryptApplication').data,

        // ローディング状態
        isEncrypting: multiApi.isLoading('encrypt'),
        isDecrypting: multiApi.isLoading('decrypt'),
        isDecryptingApplication: multiApi.isLoading('decryptApplication'),
        isRevoking: multiApi.isLoading('revoke'),

        // エラー状態
        encryptError: multiApi.getState('encrypt').error,
        decryptError: multiApi.getState('decrypt').error,
        decryptApplicationError: multiApi.getState('decryptApplication').error,
        revokeError: multiApi.getState('revoke').error,

        // アクション
        encryptLicense,
        decryptLicense,
        decryptApplicationLicense,
        revokeLicense,

        // リセット機能
        resetEncrypt: () => multiApi.reset('encrypt'),
        resetDecrypt: () => multiApi.reset('decrypt'),
        resetDecryptApplication: () => multiApi.reset('decryptApplication'),
        resetRevoke: () => multiApi.reset('revoke'),
        resetAll: () => {
            multiApi.reset('encrypt')
            multiApi.reset('decrypt')
            multiApi.reset('decryptApplication')
            multiApi.reset('revoke')
        }
    }
}

/**
 * ライセンス暗号化専用Hook（Playground用）
 */
export function useLicenseEncryption() {
    const { data, loading, error, execute, reset } = useApi<EncryptLicenseResponse>()

    const encryptLicense = useCallback(async (request: EncryptLicenseRequest) => {
        return execute(() => licenseService.encryptLicense(request))
    }, [execute])

    return {
        encryptedLicense: data,
        isEncrypting: loading,
        encryptError: error,
        encryptLicense,
        resetEncryption: reset
    }
}

/**
 * ライセンス復号化専用Hook（Playground用）
 */
export function useLicenseDecryption() {
    const { data, loading, error, execute, reset } = useApi<DecryptLicenseResponse>()

    const decryptLicense = useCallback(async (request: DecryptLicenseRequest) => {
        return execute(() => licenseService.decryptLicense(request))
    }, [execute])

    return {
        decryptedLicense: data,
        isDecrypting: loading,
        decryptError: error,
        decryptLicense,
        resetDecryption: reset
    }
}

/**
 * アプリケーションライセンス管理Hook（ダッシュボード用）
 */
export function useApplicationLicense() {
    const multiApi = useMultipleApi<{
        decrypt: { decryptedKey: string }
        revoke: void
    }>()

    const decryptLicense = useCallback(async (applicationId: string) => {
        try {
            const result = await multiApi.execute('decrypt', () =>
                licenseService.decryptApplicationLicense(applicationId)
            )
            return result
        } catch (error) {
            console.error('Failed to decrypt application license:', error)
            throw error
        }
    }, [multiApi])

    const revokeLicense = useCallback(async (applicationId: string, reason?: string) => {
        try {
            await multiApi.execute('revoke', () =>
                licenseService.revokeLicense(applicationId, reason)
            )
        } catch (error) {
            console.error('Failed to revoke license:', error)
            throw error
        }
    }, [multiApi])

    return {
        decryptedLicense: multiApi.getState('decrypt').data,
        isDecrypting: multiApi.isLoading('decrypt'),
        isRevoking: multiApi.isLoading('revoke'),
        decryptError: multiApi.getState('decrypt').error,
        revokeError: multiApi.getState('revoke').error,
        decryptLicense,
        revokeLicense,
        resetDecrypt: () => multiApi.reset('decrypt'),
        resetRevoke: () => multiApi.reset('revoke')
    }
}