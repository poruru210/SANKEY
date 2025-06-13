'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useApi } from './use-api'
import { useLicenseEncryption, useLicenseDecryption } from './use-license'
import {
    developerService,
    DeveloperServiceError,
    type IntegrationTestResponse,
    type UserProfile
} from '@/lib/services/developer.service'
import type { EncryptLicenseRequest, DecryptLicenseRequest } from '@/lib/services/license.service'

export function useDeveloper() {
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const {
        data: downloadedFile,
        loading: isDownloading,
        error: downloadError,
        execute: executeDownload,
        reset: resetDownload,
    } = useApi<Blob>()

    const {
        data: integrationTestResult,
        loading: isIntegrationTesting,
        error: integrationTestError,
        execute: executeIntegrationTest,
        reset: resetIntegrationTest,
    } = useApi<IntegrationTestResponse>()

    const {
        data: userProfile,
        loading: isLoadingProfile,
        error: profileError,
        execute: executeGetProfile,
        reset: resetProfile,
    } = useApi<UserProfile>()

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

    const downloadGasTemplate = useCallback(async () => {
        try {
            const fileBlob = await executeDownload(() => developerService.downloadGasTemplate())
            return fileBlob
        } catch (apiError) {
            throw apiError
        }
    }, [executeDownload])

    const getUserProfile = useCallback(async () => {
        try {
            const profile = await executeGetProfile(() => developerService.getUserProfile())
            return profile
        } catch (apiError) {
            throw apiError
        }
    }, [executeGetProfile])

    const startProgressPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
        }

        pollingIntervalRef.current = setInterval(() => {
            getUserProfile().catch(console.error);
        }, 5000);
    }, [getUserProfile]);

    const stopProgressPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, []);

    const isIntegrationTestCompleted = useCallback(() => {
        const progress = userProfile?.testResults?.integrationTest?.progress;
        return progress?.currentStep === 'COMPLETED';
    }, [userProfile]);

    useEffect(() => {
        if (isIntegrationTestCompleted()) {
            stopProgressPolling();
        }
    }, [isIntegrationTestCompleted, stopProgressPolling]);

    useEffect(() => {
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []);

    const startIntegrationTest = useCallback(async (gasWebappUrl: string) => {
        if (!gasWebappUrl || typeof gasWebappUrl !== 'string') {
            throw new DeveloperServiceError('WebApp URL is required');
        }

        const trimmedUrl = gasWebappUrl.trim();
        if (!trimmedUrl) {
            throw new DeveloperServiceError('WebApp URL cannot be empty');
        }

        try {
            const url = new URL(trimmedUrl);
            if (!url.hostname.includes('script.google.com')) {
                throw new DeveloperServiceError('WebApp URL must be a Google Apps Script URL');
            }
        } catch (e) {
            if (e instanceof DeveloperServiceError) throw e;
            throw new DeveloperServiceError('WebApp URL must be a valid URL');
        }

        try {
            const result = await executeIntegrationTest(() =>
                developerService.triggerIntegrationTest(trimmedUrl)
            );

            if (result?.testId) {
                startProgressPolling();
            }

            return result;
        } catch (apiError) {
            throw apiError;
        }
    }, [executeIntegrationTest, startProgressPolling])

    const generateLicense = useCallback(async (request: EncryptLicenseRequest) => {
        try {
            const result = await encryptLicense(request)
            return result
        } catch (error) {
            throw error
        }
    }, [encryptLicense])

    const validateLicense = useCallback(async (request: DecryptLicenseRequest) => {
        try {
            const result = await decryptLicense(request)
            return result
        } catch (error) {
            throw error
        }
    }, [decryptLicense])

    const isLoading = isDownloading || isEncrypting || isDecrypting || isIntegrationTesting || isLoadingProfile
    const error = downloadError || encryptError || decryptError || integrationTestError || profileError

    return {
        downloadedFile,
        isDownloading,
        downloadError,
        downloadGasTemplate,
        resetDownload,

        integrationTestResult,
        isIntegrationTesting,
        integrationTestError,
        startIntegrationTest,
        resetIntegrationTest,

        userProfile,
        isLoadingProfile,
        profileError,
        getUserProfile,
        resetProfile,

        encryptedLicense,
        isEncrypting,
        encryptError,
        generateLicense,
        resetEncryption,

        decryptedLicense,
        isDecrypting,
        decryptError,
        validateLicense,
        resetDecryption,

        isLoading,
        error,

        resetAll: () => {
            resetDownload()
            resetIntegrationTest()
            resetProfile()
            resetEncryption()
            resetDecryption()
            stopProgressPolling()
        },

        startProgressPolling,
        stopProgressPolling,
        isIntegrationTestCompleted
    }
}

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

export function useIntegrationTest() {
    const {
        data: integrationTestResult,
        loading: isLoading,
        error,
        execute: executeIntegrationTest,
        reset,
    } = useApi<IntegrationTestResponse>()

    const {
        data: userProfile,
        loading: isLoadingProfile,
        error: profileError,
        execute: executeGetProfile,
        reset: resetProfile,
    } = useApi<UserProfile>()

    const startIntegrationTest = useCallback(async (gasWebappUrl: string) => {
        if (!gasWebappUrl?.trim()) {
            throw new DeveloperServiceError('WebApp URL is required');
        }

        try {
            const result = await executeIntegrationTest(() =>
                developerService.triggerIntegrationTest(gasWebappUrl.trim())
            );
            return result;
        } catch (apiError) {
            throw apiError;
        }
    }, [executeIntegrationTest])

    const getUserProfile = useCallback(async () => {
        try {
            const profile = await executeGetProfile(() => developerService.getUserProfile())
            return profile
        } catch (apiError) {
            throw apiError
        }
    }, [executeGetProfile])

    return {
        integrationTestResult,
        isLoading,
        error,
        startIntegrationTest,
        reset,

        userProfile,
        isLoadingProfile,
        profileError,
        getUserProfile,
        resetProfile,

        isAnyLoading: isLoading || isLoadingProfile,
        hasAnyError: !!(error || profileError),

        resetAll: () => {
            reset()
            resetProfile()
        }
    }
}

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
        encryptedLicense,
        isEncrypting,
        encryptError,
        generateLicense,
        resetEncryption,

        decryptedLicense,
        isDecrypting,
        decryptError,
        validateLicense,
        resetDecryption,

        isLoading: isEncrypting || isDecrypting,
        hasError: !!(encryptError || decryptError),
        resetAll: () => {
            resetEncryption()
            resetDecryption()
        }
    }
}