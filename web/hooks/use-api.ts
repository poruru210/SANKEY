'use client'

import { useState, useCallback, useEffect } from 'react'
import { HttpError } from '@/lib/http-client'
import { useRouter } from 'next/navigation'

/**
 * API呼び出しの状態管理
 */
export interface ApiState<T> {
    data: T | null
    loading: boolean
    error: string | null
}

/**
 * API呼び出し結果
 */
export interface ApiCallResult<T> {
    data: T | null
    loading: boolean
    error: string | null
    execute: (apiCall: () => Promise<T>) => Promise<T | null>
    reset: () => void
    retry: () => Promise<T | null>
}

/**
 * 汎用API呼び出しHook
 * ローディング状態、エラーハンドリング、リトライ機能を提供
 */
export function useApi<T = any>(): ApiCallResult<T> {
    const router = useRouter()
    const [state, setState] = useState<ApiState<T>>({
        data: null,
        loading: false,
        error: null
    })

    const [lastApiCall, setLastApiCall] = useState<(() => Promise<T>) | null>(null)

    const execute = useCallback(async (apiCall: () => Promise<T>): Promise<T | null> => {
        setState(prev => ({ ...prev, loading: true, error: null }))
        setLastApiCall(() => apiCall)

        try {
            const result = await apiCall()
            setState({ data: result, loading: false, error: null })
            return result
        } catch (error) {
            let errorMessage = 'An unexpected error occurred'

            if (error instanceof HttpError) {
                errorMessage = error.message

                // 認証エラーの場合
                if (error.status === 401) {
                    errorMessage = 'Authentication required. Please sign in again.'
                    setTimeout(() => router.push('/login'), 100)
                }
                // アクセス拒否
                else if (error.status === 403) {
                    errorMessage = 'Access denied. Please check your permissions.'
                }
            } else if (error instanceof Error) {
                errorMessage = error.message
            }

            setState(prev => ({ ...prev, loading: false, error: errorMessage }))
            throw error
        }
    }, [router])

    const reset = useCallback(() => {
        setState({ data: null, loading: false, error: null })
        setLastApiCall(null)
    }, [])

    const retry = useCallback(async (): Promise<T | null> => {
        if (!lastApiCall) {
            console.warn('No previous API call to retry')
            return null
        }
        return execute(lastApiCall)
    }, [lastApiCall, execute])

    return {
        data: state.data,
        loading: state.loading,
        error: state.error,
        execute,
        reset,
        retry
    }
}

/**
 * 複数のAPI呼び出しを管理するHook
 */
export function useMultipleApi<T extends Record<string, any>>() {
    const router = useRouter()
    const [states, setStates] = useState<Record<keyof T, ApiState<any>>>({} as any)

    const execute = useCallback(async <K extends keyof T>(
        key: K,
        apiCall: () => Promise<T[K]>
    ): Promise<T[K] | null> => {
        setStates(prev => ({
            ...prev,
            [key]: { ...prev[key], loading: true, error: null }
        }))

        try {
            const result = await apiCall()
            setStates(prev => ({
                ...prev,
                [key]: { data: result, loading: false, error: null }
            }))
            return result
        } catch (error) {
            let errorMessage = 'An unexpected error occurred'

            if (error instanceof HttpError) {
                errorMessage = error.message

                if (error.status === 401) {
                    setTimeout(() => router.push('/login'), 100)
                }
            } else if (error instanceof Error) {
                errorMessage = error.message
            }

            setStates(prev => ({
                ...prev,
                [key]: { ...prev[key], loading: false, error: errorMessage }
            }))
            throw error
        }
    }, [router])

    const reset = useCallback((key?: keyof T) => {
        if (key) {
            setStates(prev => ({
                ...prev,
                [key]: { data: null, loading: false, error: null }
            }))
        } else {
            setStates({} as any)
        }
    }, [])

    const getState = useCallback(<K extends keyof T>(key: K): ApiState<T[K]> => {
        return states[key] || { data: null, loading: false, error: null }
    }, [states])

    return {
        execute,
        reset,
        getState,
        isLoading: (key: keyof T) => getState(key).loading,
        hasError: (key: keyof T) => !!getState(key).error,
        getData: <K extends keyof T>(key: K) => getState(key).data
    }
}

/**
 * 無限ローディング（ページネーション）用Hook
 */
export function useInfiniteApi<T>() {
    const router = useRouter()
    const [items, setItems] = useState<T[]>([])
    const [hasMore, setHasMore] = useState(true)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const loadMore = useCallback(async (
        apiCall: (offset: number, limit: number) => Promise<{ items: T[], hasMore: boolean }>
    ) => {
        if (loading) return

        setLoading(true)
        setError(null)

        try {
            const result = await apiCall(items.length, 20) // デフォルト20件ずつ

            setItems(prev => [...prev, ...result.items])
            setHasMore(result.hasMore)
        } catch (error) {
            let errorMessage = 'Failed to load more items'

            if (error instanceof HttpError) {
                errorMessage = error.message

                if (error.status === 401) {
                    setTimeout(() => router.push('/login'), 100)
                }
            } else if (error instanceof Error) {
                errorMessage = error.message
            }

            setError(errorMessage)
        } finally {
            setLoading(false)
        }
    }, [items.length, loading, router])

    const reset = useCallback(() => {
        setItems([])
        setHasMore(true)
        setLoading(false)
        setError(null)
    }, [])

    return {
        items,
        hasMore,
        loading,
        error,
        loadMore,
        reset
    }
}

/**
 * データをキャッシュするHook
 */
export function useCachedApi<T>(
    cacheKey: string,
    cacheDuration: number = 5 * 60 * 1000 // 5分
) {
    const [cache, setCache] = useState<{
        [key: string]: { data: T; timestamp: number }
    }>({})

    const { data, loading, error, execute, reset } = useApi<T>()

    const cachedExecute = useCallback(async (apiCall: () => Promise<T>): Promise<T | null> => {
        // キャッシュチェック
        const cached = cache[cacheKey]
        const now = Date.now()

        if (cached && (now - cached.timestamp) < cacheDuration) {
            return cached.data
        }

        // キャッシュが無効な場合は新しくデータを取得
        const result = await execute(apiCall)

        if (result) {
            setCache(prev => ({
                ...prev,
                [cacheKey]: { data: result, timestamp: now }
            }))
        }

        return result
    }, [cache, cacheKey, cacheDuration, execute])

    const clearCache = useCallback((key?: string) => {
        if (key) {
            setCache(prev => {
                const newCache = { ...prev }
                delete newCache[key]
                return newCache
            })
        } else {
            setCache({})
        }
    }, [])

    return {
        data,
        loading,
        error,
        execute: cachedExecute,
        reset,
        clearCache
    }
}

/**
 * ポーリング機能付きAPI呼び出しHook
 */
export function useApiPolling<T = any>(
    apiCall: () => Promise<T>,
    options: {
        interval?: number
        maxAttempts?: number
        enabled?: boolean
        onSuccess?: (data: T) => void
        onError?: (error: HttpError) => void
        shouldContinue?: (data: T | null, error: string | null, attempts: number) => boolean
    } = {}
): ApiCallResult<T> & { stop: () => void; start: () => void; attempts: number } {
    const {
        interval = 2000,
        maxAttempts = 10,
        enabled = false,
        onSuccess,
        onError,
        shouldContinue
    } = options

    const [attempts, setAttempts] = useState(0)
    const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null)

    const api = useApi<T>()

    const stop = useCallback(() => {
        if (intervalId) {
            clearInterval(intervalId)
            setIntervalId(null)
        }
    }, [intervalId])

    const start = useCallback(() => {
        if (intervalId) return

        const id = setInterval(async () => {
            try {
                const result = await api.execute(apiCall)
                setAttempts(prev => prev + 1)

                if (result && onSuccess) {
                    onSuccess(result)
                }

                // カスタム継続条件
                if (shouldContinue) {
                    if (!shouldContinue(result, null, attempts + 1)) {
                        stop()
                    }
                } else if (attempts + 1 >= maxAttempts) {
                    stop()
                }
            } catch (error) {
                setAttempts(prev => prev + 1)

                if (error instanceof HttpError && onError) {
                    onError(error)
                }

                // エラーまたは最大試行回数に達した場合は停止
                if (attempts + 1 >= maxAttempts || (shouldContinue && !shouldContinue(null, api.error, attempts + 1))) {
                    stop()
                }
            }
        }, interval)

        setIntervalId(id)
    }, [api, apiCall, attempts, interval, maxAttempts, onSuccess, onError, shouldContinue, stop])

    // enabledが変更されたときの処理
    useEffect(() => {
        if (enabled) {
            start()
        } else {
            stop()
        }

        return () => stop()
    }, [enabled, start, stop])

    return {
        ...api,
        stop,
        start,
        attempts
    }
}