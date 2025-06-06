"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Shield, Key, FileKey, Loader2, AlertCircle } from "lucide-react"
import Image from "next/image"
import { useI18n } from "@/lib/i18n-context"

export default function LoginPage() {
    const router = useRouter()
    const searchParams = useSearchParams() //  searchParams is already defined at the top level
    const { data: session, status } = useSession()
    const { t, language: i18nLanguage } = useI18n() // Renamed to i18nLanguage

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState("")

    // リダイレクト用のreturnUrl取得
    const returnUrl = searchParams.get('returnUrl') || '/dashboard'
    const authError = searchParams.get('error')

    // 認証エラーの処理
    useEffect(() => {
        if (authError) {
            switch (authError) {
                case 'Configuration':
                    setError(t("login.configurationError"))
                    break
                case 'AccessDenied':
                    setError(t("login.accessDenied"))
                    break
                case 'Verification':
                    setError(t("login.verificationError"))
                    break
                default:
                    setError(t("login.loginFailed"))
            }
        }
    }, [authError, t])

    // 既にログイン済みの場合はリダイレクト
    useEffect(() => {
        const handleRedirect = async () => {
            if (status === "authenticated") {
                const decodedReturnUrl = decodeURIComponent(returnUrl)

                console.log('Already authenticated, redirecting to:', decodedReturnUrl)

                // returnUrlが安全かどうかチェック
                try {
                    const url = new URL(decodedReturnUrl, window.location.origin)
                    if (url.origin === window.location.origin) {
                        router.push(decodedReturnUrl)
                    } else {
                        router.push('/dashboard')
                    }
                } catch {
                    if (decodedReturnUrl.startsWith('/')) {
                        router.push(decodedReturnUrl)
                    } else {
                        router.push('/dashboard')
                    }
                }
            }
        }

        handleRedirect()
    }, [status, router, returnUrl])

    const handleSignIn = async () => {
        setIsLoading(true)
        setError("")

        try {
            const decodedReturnUrl = decodeURIComponent(returnUrl)

            // returnUrlが安全かどうかチェックして、callbackUrlを設定
            let callbackUrl = '/dashboard'
            try {
                const url = new URL(decodedReturnUrl, window.location.origin)
                if (url.origin === window.location.origin) {
                    callbackUrl = decodedReturnUrl
                }
            } catch {
                if (decodedReturnUrl.startsWith('/')) {
                    callbackUrl = decodedReturnUrl
                }
            }

            const langFromUrl = searchParams.get('lang')
            let uiLocalesForCognito = i18nLanguage // Default to i18n language

            if (langFromUrl === 'en' || langFromUrl === 'ja') {
                uiLocalesForCognito = langFromUrl
            }

            console.log(`[LoginPage] handleSignIn: langFromUrl='${langFromUrl}', i18nLanguage='${i18nLanguage}', uiLocalesForCognito='${uiLocalesForCognito}'`)

            await signIn('cognito', { callbackUrl }, { lang: uiLocalesForCognito })
        } catch (err: any) {
            console.error("Sign in error:", err)
            setError(t("login.loginFailed"))
            setIsLoading(false)
        }
    }

    // 認証チェック中の表示
    if (status === "loading") {
        return (
            <div className="text-center space-y-4">
                <div className="flex items-center justify-center w-16 h-16 mx-auto bg-emerald-500/10 rounded-full border border-emerald-400/20">
                    <Shield className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="flex items-center justify-center space-x-2">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                    <span className="theme-text-secondary">{t("login.checkingAuth")}</span>
                </div>
                <p className="text-slate-400 text-sm">
                    {t("login.securingAccess")}
                </p>
            </div>
        )
    }

    // 認証済みの場合は何も表示しない（useEffectでリダイレクト処理）
    if (status === "authenticated") {
        return null
    }

    return (
        <div className="w-full max-w-md">
            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm shadow-2xl">
                <CardHeader className="text-center space-y-4 pb-6">
                    {/* Logo Section */}
                    <div className="flex justify-center">
                        <div className="flex items-center justify-center w-16 h-16 bg-emerald-500/10 rounded-xl border border-emerald-400/20">
                            <Image src="/sankey-logo.svg" alt="SANKEY Logo" width={40} height={40} className="w-10 h-10" />
                        </div>
                    </div>

                    {/* Title */}
                    <div className="space-y-2">
                        <CardTitle className="text-2xl font-bold theme-text-primary">{t("login.title")}</CardTitle>
                        <CardDescription className="theme-text-secondary">{t("login.subtitle")}</CardDescription>
                    </div>

                    {/* Features Icons */}
                    <div className="flex items-center justify-center space-x-6 pt-2">
                        <Shield className="w-5 h-5 text-emerald-400" />
                        <Key className="w-5 h-5 text-emerald-400" />
                        <FileKey className="w-5 h-5 text-emerald-400" />
                    </div>
                </CardHeader>

                <CardContent className="space-y-6 px-6">
                    {/* Error Display */}
                    {error && (
                        <Alert className="border-red-500/20 bg-red-500/10">
                            <AlertCircle className="h-4 w-4 text-red-400" />
                            <AlertDescription className="text-red-300">{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Hosted UI Login Section */}
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <p className="text-sm theme-text-secondary">
                                {t("login.hostedUIDescription")}
                            </p>
                            <p className="text-xs theme-text-muted">
                                {t("login.redirectNotice")}
                            </p>
                        </div>

                        {/* Sign In Button */}
                        <Button
                            onClick={handleSignIn}
                            disabled={isLoading}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <div className="flex items-center justify-center space-x-2">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>{t("login.signingIn")}</span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center space-x-2">
                                    <Shield className="w-4 h-4" />
                                    <span>{t("login.signIn")}</span>
                                </div>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}