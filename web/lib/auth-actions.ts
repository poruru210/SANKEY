// lib/auth-actions.ts
'use client'

import { signOut } from "next-auth/react"

/**
 * Cognitoからも完全にログアウトする（クライアントサイド版）
 */
export async function signOutCompletely() {
    try {
        // NextAuthのセッションをクリア
        await signOut({
            redirect: false
        })

        // Cognito Hosted UIのログアウトエンドポイントを構築
        const cognitoDomain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN
        const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
        const logoutRedirectUri = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/login`

        if (cognitoDomain && clientId) {
            // Cognitoのログアウトエンドポイントにリダイレクト
            const logoutUrl = `${cognitoDomain}/logout?` +
                `client_id=${clientId}&` +
                `logout_uri=${encodeURIComponent(logoutRedirectUri)}`

            window.location.href = logoutUrl
        } else {
            // Cognito設定が不完全な場合は通常のリダイレクト
            console.warn('Cognito logout configuration missing')
            window.location.href = '/login'
        }
    } catch (error) {
        console.error('Sign out error:', error)
        // エラーが発生してもログインページへリダイレクト
        window.location.href = '/login'
    }
}