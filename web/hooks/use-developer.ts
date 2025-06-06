// hooks/use-developer.ts - ライセンス機能統合版
'use client'

import { useCallback } from 'react'
import { useApi } from './use-api'
import { useLicenseEncryption, useLicenseDecryption } from './use-license'
import { developerService, DeveloperServiceError } from '@/lib/services/developer.service'
import type { EncryptLicenseRequest, DecryptLicenseRequest } from '@/lib/services/license.service'

/**
 * 開発者機能統合Hook
 * GASテンプレートダウンロード + ライセンス機能（Playground用）
 */
export function useDeveloper() {
    // GASテンプレートダウンロード
    const {
        data: downloadedFile,
        loading: isDownloading,
        error: downloadError,
        execute: executeDownload,
        reset: resetDownload,
    } = useApi<Blob>()

    // ライセンス暗号化機能
    const {
        encryptedLicense,
        isEncrypting,
        encryptError,
        encryptLicense,
        resetEncryption
    } = useLicenseEncryption()

    // ライセンス復号化機能
    const {
        decryptedLicense,
        isDecrypting,
        decryptError,
        decryptLicense,
        resetDecryption
    } = useLicenseDecryption()

    /**
     * GASテンプレートダウンロード
     */
    const downloadGasTemplate = useCallback(async () => {
        try {
            const fileBlob = await executeDownload(() => developerService.downloadGasTemplate())

            if (fileBlob) {
                return fileBlob
            }
            return null
        } catch (apiError) {
            throw apiError
        }
    }, [executeDownload])

    /**
     * ライセンス生成（Playground用）
     */
    const generateLicense = useCallback(async (request: EncryptLicenseRequest) => {
        try {
            const result = await encryptLicense(request)
            return result
        } catch (error) {
            console.error('Failed to generate license:', error)
            throw error
        }
    }, [encryptLicense])

    /**
     * ライセンス検証（Playground用）
     */
    const validateLicense = useCallback(async (request: DecryptLicenseRequest) => {
        try {
            const result = await decryptLicense(request)
            return result
        } catch (error) {
            console.error('Failed to validate license:', error)
            throw error
        }
    }, [decryptLicense])

    // 統合ローディング状態
    const isLoading = isDownloading || isEncrypting || isDecrypting

    // 統合エラー状態
    const error = downloadError || encryptError || decryptError

    return {
        // GASテンプレート関連
        downloadedFile,
        isDownloading,
        downloadError,
        downloadGasTemplate,
        resetDownload,

        // ライセンス暗号化関連
        encryptedLicense,
        isEncrypting,
        encryptError,
        generateLicense,
        resetEncryption,

        // ライセンス復号化関連
        decryptedLicense,
        isDecrypting,
        decryptError,
        validateLicense,
        resetDecryption,

        // 統合状態
        isLoading,
        error,

        // 全リセット
        resetAll: () => {
            resetDownload()
            resetEncryption()
            resetDecryption()
        }
    }
}

/**
 * GASダウンロード専用Hook（軽量版）
 */
export function useGasDownload() {
    const {
        data: downloadedFile,
        loading: isLoading,
        error,
        execute: executeDownload,
        reset,
    } = useApi<Blob>()

    const downloadGasTemplate = useCallback(async () => {
        try {
            const fileBlob = await executeDownload(() => developerService.downloadGasTemplate())
            return fileBlob
        } catch (apiError) {
            throw apiError
        }
    }, [executeDownload])

    return {
        downloadedFile,
        isLoading,
        error,
        downloadGasTemplate,
        reset,
    }
}

/**
 * Playground専用Hook（ライセンス機能のみ）
 */
export function usePlayground() {
    const {
        encryptedLicense,
        isEncrypting,
        encryptError,
        encryptLicense,
        resetEncryption
    } = useLicenseEncryption()

    const {
        decryptedLicense,
        isDecrypting,
        decryptError,
        decryptLicense,
        resetDecryption
    } = useLicenseDecryption()

    const generateLicense = useCallback(async (request: EncryptLicenseRequest) => {
        return encryptLicense(request)
    }, [encryptLicense])

    const validateLicense = useCallback(async (request: DecryptLicenseRequest) => {
        return decryptLicense(request)
    }, [decryptLicense])

    return {
        // 暗号化
        encryptedLicense,
        isEncrypting,
        encryptError,
        generateLicense,
        resetEncryption,

        // 復号化
        decryptedLicense,
        isDecrypting,
        decryptError,
        validateLicense,
        resetDecryption,

        // ユーティリティ
        isLoading: isEncrypting || isDecrypting,
        hasError: !!(encryptError || decryptError),
        resetAll: () => {
            resetEncryption()
            resetDecryption()
        }
    }
}