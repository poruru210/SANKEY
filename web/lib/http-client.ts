// lib/http-client.ts - シンプル化版（idTokenセッション対応）
import { auth } from "@/lib/auth"
import { getSession } from "next-auth/react"

// 基本型定義
export class HttpError extends Error {
    constructor(
        message: string,
        public status: number,
        public response?: any
    ) {
        super(message)
        this.name = 'HttpError'
    }
}

export interface RequestConfig {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    headers?: Record<string, string>
    body?: any
    requireAuth?: boolean
    timeout?: number
    useProxy?: boolean
    responseType?: 'json' | 'text' | 'blob'
}

export interface HttpClientConfig {
    baseURL: string
    proxyURL?: string
    defaultHeaders?: Record<string, string>
    timeout?: number
    retryAttempts?: number
}

/**
 * ID Token対応版HTTPクライアント
 * AWS API Gateway Cognito Authorizerに対応
 */
export class HttpClient {
    private config: HttpClientConfig
    private retryAttempts: number

    constructor(config: HttpClientConfig) {
        this.config = {
            timeout: 15000,
            retryAttempts: 1,
            proxyURL: '/api/proxy',
            ...config
        }
        this.retryAttempts = this.config.retryAttempts || 1
    }

    /**
     * 環境に応じた認証ヘッダー取得（ID Token使用）
     */
    private async getAuthHeaders(): Promise<Record<string, string>> {
        let session: any = null

        // サーバーサイド
        if (typeof window === 'undefined') {
            session = await auth()
        }
        // クライアントサイド
        else {
            session = await getSession()
        }

        if (!session?.idToken) {
            throw new HttpError('No valid ID token found', 401)
        }

        // セッションエラーチェック
        if (session.error === "RefreshAccessTokenError") {
            throw new HttpError('Token refresh failed. Please sign in again.', 401)
        }

        return {
            'Authorization': `Bearer ${session.idToken}`,
        }
    }

    /**
     * セッションリフレッシュ（クライアントサイドのみ）
     */
    private async refreshSession(): Promise<void> {
        try {
            if (typeof window !== 'undefined') {
                const response = await fetch('/api/auth/session?update=true', {
                    method: 'GET',
                    credentials: 'include'
                })

                if (response.ok) {
                    // セッション更新通知
                    window.dispatchEvent(new Event('storage'))
                }
            }
        } catch (error) {
            console.error('Failed to refresh session:', error)
        }
    }

    /**
     * 汎用リクエストメソッド
     */
    async request<T = any>(
        endpoint: string,
        config: RequestConfig = {},
        retryCount: number = 0
    ): Promise<T> {
        const {
            method = 'GET',
            headers = {},
            body,
            requireAuth = true,
            timeout = this.config.timeout,
            useProxy = false,
            responseType = 'json'
        } = config

        try {
            let targetUrl: string
            let requestHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...this.config.defaultHeaders,
                ...headers
            }

            if (useProxy) {
                // プロキシ経由（CORS回避）
                targetUrl = `${this.config.proxyURL}${endpoint}`
            } else {
                // 直接アクセス
                targetUrl = `${this.config.baseURL}${endpoint}`

                // 認証ヘッダー取得
                if (requireAuth) {
                    try {
                        const authHeaders = await this.getAuthHeaders()
                        requestHeaders = { ...requestHeaders, ...authHeaders }
                    } catch (authError) {
                        console.error('🔐 Authentication failed:', authError)
                        if (authError instanceof HttpError) {
                            throw authError
                        }
                        throw new HttpError('Authentication failed', 401)
                    }
                }
            }

            // リクエスト設定
            const requestConfig: RequestInit = {
                method,
                headers: requestHeaders,
                credentials: useProxy ? 'same-origin' : 'omit',
            }

            // ボディ設定
            if (body && method !== 'GET') {
                requestConfig.body = JSON.stringify(body)
            }

            // タイムアウト設定
            if (typeof window !== 'undefined' && timeout) {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), timeout)
                requestConfig.signal = controller.signal

                try {
                    const response = await fetch(targetUrl, requestConfig)
                    clearTimeout(timeoutId)
                    return await this.handleResponse<T>(response, endpoint, config, retryCount, responseType)
                } catch (error) {
                    clearTimeout(timeoutId)
                    throw error
                }
            } else {
                const response = await fetch(targetUrl, requestConfig)
                return await this.handleResponse<T>(response, endpoint, config, retryCount, responseType)
            }

        } catch (error) {
            console.error('🚨 Request failed:', {
                endpoint,
                error: error instanceof Error ? error.message : error,
                retryCount,
                useProxy: config.useProxy
            })

            if (error instanceof HttpError) {
                throw error
            }

            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    throw new HttpError('Request timeout', 408)
                }
                if (error.message.includes('CORS') || error.message.includes('fetch')) {
                    throw new HttpError(`Network error: ${error.message}`, 0)
                }
                throw new HttpError(error.message, 0)
            }

            throw new HttpError('Unknown error occurred', 0)
        }
    }

    /**
     * レスポンス処理
     */
    private async handleResponse<T>(
        response: Response,
        endpoint: string,
        config: RequestConfig,
        retryCount: number,
        responseType?: 'json' | 'text' | 'blob'
    ): Promise<T> {
        // レスポンス解析
        let responseData: any = null
        const contentType = response.headers.get('content-type')

        try {
            if (responseType === 'blob' && response.ok) {
                responseData = await response.blob()
            } else if (contentType?.includes('application/json')) {
                responseData = await response.json()
            } else if (response.status !== 204) {
                responseData = await response.text()
            }
        } catch (parseError) {
            console.error('Failed to parse response:', parseError)
            if (!response.ok) {
                throw new HttpError(`HTTP ${response.status}: ${response.statusText}`, response.status)
            }
        }

        // 401エラーの場合、リトライ処理（クライアントサイドのみ）
        if (response.status === 401 && config.requireAuth && retryCount < this.retryAttempts && typeof window !== 'undefined') {
            console.log(`Authentication failed (attempt ${retryCount + 1}), refreshing...`)

            try {
                await this.refreshSession()
                await new Promise(resolve => setTimeout(resolve, 1000))
                return this.request<T>(endpoint, { ...config, responseType }, retryCount + 1)
            } catch (refreshError) {
                console.error('Session refresh failed:', refreshError)
            }
        }

        // エラーハンドリング
        if (!response.ok) {
            let errorMessage = responseData?.message || responseData?.error || `HTTP ${response.status}: ${response.statusText}`

            if (response.status === 401) {
                errorMessage = 'Authentication failed. Please sign in again.'
            } else if (response.status === 403) {
                errorMessage = 'Access denied. Please check your permissions.'
            } else if (response.status === 0) {
                errorMessage = 'Network error. Please check your connection.'
            }

            throw new HttpError(errorMessage, response.status, responseData)
        }

        return responseData
    }

    // 便利メソッド
    async get<T = any>(endpoint: string, config?: Omit<RequestConfig, 'method'>): Promise<T> {
        return this.request<T>(endpoint, { ...config, method: 'GET' })
    }

    async post<T = any>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
        return this.request<T>(endpoint, { ...config, method: 'POST', body })
    }

    async put<T = any>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
        return this.request<T>(endpoint, { ...config, method: 'PUT', body })
    }

    async patch<T = any>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
        return this.request<T>(endpoint, { ...config, method: 'PATCH', body })
    }

    async delete<T = any>(endpoint: string, config?: Omit<RequestConfig, 'method'>): Promise<T> {
        return this.request<T>(endpoint, { ...config, method: 'DELETE' })
    }

    /**
     * 🧪 接続テスト
     */
    async testConnection(): Promise<any> {
        try {
            console.log('🧪 Testing basic connection...')
            return await this.get('/health', {
                requireAuth: false,
            })
        } catch (error) {
            console.error('🧪 Connection test failed:', error)
            throw error
        }
    }

    /**
     * 🔐 認証付きテスト
     */
    async testAuthenticatedConnection(): Promise<any> {
        try {
            console.log('🔐 Testing authenticated connection...')
            return await this.get('/user/ea-applications', {
                requireAuth: true,
            })
        } catch (error) {
            console.error('🔐 Authenticated connection test failed:', error)
            throw error
        }
    }
}

// デフォルトインスタンス
export const httpClient = new HttpClient({
    baseURL: process.env.NEXT_PUBLIC_API_ENDPOINT || 'https://cuhoff7tsf.execute-api.ap-northeast-1.amazonaws.com/prod',
    defaultHeaders: {
        'Accept': 'application/json',
    },
    timeout: 15000,
    retryAttempts: 1
})