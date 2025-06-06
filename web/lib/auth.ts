// lib/auth.ts - クッキーサイズ最適化版
import NextAuth from "next-auth"
import CognitoProvider from "next-auth/providers/cognito"
import { JWT } from "next-auth/jwt"

// トークンリフレッシュ関数
async function refreshAccessToken(token: JWT): Promise<JWT> {
    try {
        const url = `${process.env.COGNITO_ISSUER}/oauth2/token`

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: process.env.COGNITO_CLIENT_ID!,
                client_secret: process.env.COGNITO_CLIENT_SECRET!,
                refresh_token: token.refreshToken as string,
            }),
        })

        const refreshedTokens = await response.json()

        if (!response.ok) {
            throw refreshedTokens
        }

        return {
            ...token,
            accessToken: refreshedTokens.access_token,
            idToken: refreshedTokens.id_token,
            refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
            accessTokenExpires: Date.now() + (refreshedTokens.expires_in * 1000),
        }
    } catch (error) {
        console.error("Error refreshing access token", error)
        return {
            ...token,
            error: "RefreshAccessTokenError",
        }
    }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [
        CognitoProvider({
            clientId: process.env.COGNITO_CLIENT_ID!,
            clientSecret: process.env.COGNITO_CLIENT_SECRET!,
            issuer: process.env.COGNITO_ISSUER!,
        })
    ],

    callbacks: {
        async jwt({ token, account }): Promise<JWT> {
            // 初回ログイン時
            if (account) {
                return {
                    ...token,
                    accessToken: account.access_token,
                    idToken: account.id_token,
                    refreshToken: account.refresh_token,
                    accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600000,
                } as JWT
            }

            // アクセストークンがまだ有効な場合
            if (Date.now() < (token.accessTokenExpires as number)) {
                return token
            }

            // トークンリフレッシュ
            return refreshAccessToken(token)
        },

        async session({ session, token }) {
            // idTokenのみをセッションに含める（ユーザー情報はidToken内に含まれる）
            if (token.idToken) {
                session.idToken = token.idToken as string
            }

            // エラー情報を伝播
            if (token.error) {
                session.error = token.error as string
            }

            return session
        },

        // 認証が必要なページへのアクセス制御
        async authorized({ auth, request }) {
            const { pathname } = request.nextUrl

            // 公開ルート
            const publicRoutes = ['/', '/about', '/contact', '/terms', '/privacy']

            // 認証関連ルート
            const authRoutes = ['/login', '/signup', '/forgot-password']

            // 公開ルートは認証不要
            if (publicRoutes.includes(pathname)) {
                return true
            }

            // 認証関連ルートは認証不要
            if (authRoutes.some(route => pathname.startsWith(route))) {
                return true
            }

            // API認証ルートは通す
            if (pathname.startsWith('/api/auth')) {
                return true
            }

            // 認証が必要なルート
            if (!auth) {
                return false
            }

            // トークンエラーがある場合
            if (auth.error === "RefreshAccessTokenError") {
                return false
            }

            return true
        }
    },

    pages: {
        signIn: '/login',
        error: '/auth/error',
    },

    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30日
    },

    debug: process.env.NODE_ENV === 'development',
})