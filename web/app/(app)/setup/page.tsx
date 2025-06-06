"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, AlertCircle, RefreshCw } from "lucide-react"

export default function SetupPage() {
    const router = useRouter()
    const { data: session, update } = useSession()
    const [isChecking, setIsChecking] = useState(true)
    const [error, setError] = useState("")
    const [checkCount, setCheckCount] = useState(0)
    const maxChecks = 20

    useEffect(() => {
        if (!session) {
            router.push('/login')
            return
        }

        // 既にセットアップが完了している場合はダッシュボードへ
        // (isNewUser が false になっている、または role があるかで判断)
        if (session.user && !session.user.isNewUser) { // ★ 変更点
            router.push('/dashboard')
            return
        }

        checkUserSetupStatus() // ★ 関数名変更
    }, [session, router]) // router を依存配列に追加

    const checkUserSetupStatus = async () => { // ★ 関数名変更
        setIsChecking(true)
        setError("")

        try {
            // セッションを更新して最新の情報を取得
            const updatedSession = await update()
            
            // isNewUser が false になったか、または role が設定されたかを確認
            if (updatedSession?.user && !updatedSession.user.isNewUser) { // ★ 変更点
                setTimeout(() => {
                    router.push('/dashboard')
                }, 1000)
                return
            }

            // まだセットアップが完了していない場合
            setCheckCount(prev => prev + 1)

            if (checkCount < maxChecks) {
                // 2秒後に再チェック
                setTimeout(() => {
                    checkUserSetupStatus() // ★ 関数名変更
                }, 2000)
            } else {
                // タイムアウト
                setError("セットアップに時間がかかっています。しばらくしてから再度お試しください。")
                setIsChecking(false)
            }
        } catch (err) {
            console.error("Setup check error:", err)
            setError("エラーが発生しました。ページを更新してください。")
            setIsChecking(false)
        }
    }

    const handleRetry = () => {
        setCheckCount(0)
        setError("")
        checkUserSetupStatus() // ★ 関数名変更
    }

    const handleManualRefresh = async () => {
        setIsChecking(true)
        try {
            await update() // セッション更新を試みる
            checkUserSetupStatus() // ★ 関数名変更
        } catch (err) {
            console.error("Manual refresh error:", err)
            setError("更新に失敗しました。")
            setIsChecking(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-full">
                            {isChecking ? (
                                <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
                            ) : error ? (
                                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                            ) : (
                                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                            )}
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold">
                        {isChecking ? "アカウント設定中..." : error ? "設定エラー" : "設定完了！"}
                    </CardTitle>
                    <CardDescription>
                        {isChecking 
                            ? "初回ログインのセットアップを行っています。しばらくお待ちください。"
                            : error 
                            ? "アカウントの設定中にエラーが発生しました。"
                            : "アカウントの設定が完了しました。ダッシュボードに移動します。"
                        }
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {isChecking && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-400">
                                    進行状況
                                </span>
                                <span className="font-medium">
                                    {Math.min(Math.round((checkCount / maxChecks) * 100), 95)}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div 
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min((checkCount / maxChecks) * 100, 95)}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                通常、このプロセスは10秒以内に完了します
                            </p>
                        </div>
                    )}

                    {error && (
                        <Alert className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20">
                            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                            <AlertDescription className="text-red-800 dark:text-red-200">
                                {error}
                            </AlertDescription>
                        </Alert>
                    )}

                    {error && (
                        <div className="flex gap-3">
                            <Button 
                                onClick={handleRetry}
                                className="flex-1"
                                variant="default"
                            >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                再試行
                            </Button>
                            <Button 
                                onClick={handleManualRefresh}
                                className="flex-1"
                                variant="outline"
                            >
                                手動更新
                            </Button>
                        </div>
                    )}

                    {!isChecking && !error && (
                        <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20">
                            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <AlertDescription className="text-green-800 dark:text-green-200">
                                セットアップが完了しました！ダッシュボードに移動します...
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}