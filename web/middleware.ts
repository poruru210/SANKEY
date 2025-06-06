// middleware.ts - Auth.js v5最適化版
export { auth as middleware } from "@/lib/auth"

// middlewareを適用するパスを設定
export const config = {
    matcher: [
        /*
         * 以下のパスを除くすべてのルートにマッチ:
         * - api/auth (NextAuth.js API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public folder files
         */
        '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$).*)',
    ],
}