"use client"

import React, { useState, useEffect } from "react"
import { Sidebar } from "@/app/components/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import ParticlesBackground from "@/app/components/ParticlesBackground"
import { useTheme } from "@/lib/theme-context"
import { MobileHeader } from "@/app/components/mobile-header"

interface AppLayoutProps {
    children: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const [mounted, setMounted] = useState(false)
    const { theme } = useTheme()

    // hydration完了まで待つ
    useEffect(() => {
        setMounted(true)
    }, [])

    // モバイル検出とサイドバー制御
    useEffect(() => {
        if (typeof window === 'undefined') return

        const checkMobile = () => {
            const mobile = window.innerWidth < 1024
            setIsMobile(mobile)

            // デスクトップでは初期状態で開く、モバイルでは閉じる
            if (mobile) {
                setSidebarOpen(false)
            } else {
                // デスクトップの場合、ローカルストレージから状態を読み込む
                const savedState = localStorage.getItem('sidebar-open')
                setSidebarOpen(savedState !== null ? JSON.parse(savedState) : true)
            }
        }

        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    // サイドバーの状態をローカルストレージに保存（デスクトップのみ）
    useEffect(() => {
        if (!isMobile && mounted) {
            localStorage.setItem('sidebar-open', JSON.stringify(sidebarOpen))
        }
    }, [sidebarOpen, isMobile, mounted])

    return (
        <>
            {/* 🔧 修正: ParticlesBackgroundは条件分岐の外に */}
            {mounted && <ParticlesBackground theme={(theme as "light" | "dark") || "dark"} />}

            <div className="min-h-screen flex relative z-0">
                {/* 🔧 修正: Sidebarのstyleプロパティを削除し、条件分岐で制御 */}
                {mounted ? (
                    <Sidebar
                        setSidebarOpen={setSidebarOpen}
                        sidebarOpen={sidebarOpen}
                        isMobile={isMobile}
                    />
                ) : (
                    // hydration前は空のサイドバー領域を確保
                    <div className="w-0" />
                )}

                {/* メインコンテンツエリア */}
                <div
                    className={`flex-1 flex flex-col min-w-0 relative z-10 transition-all duration-300 ease-in-out ${
                        mounted ? (
                            isMobile
                                ? 'ml-0'
                                : sidebarOpen
                                    ? 'ml-64'
                                    : 'ml-16'
                        ) : 'ml-0'
                    }`}
                >
                    {/* 🔧 修正: ヘッダーの条件分岐を改善 */}
                    <header className="flex justify-between items-center p-4">
                        {mounted && isMobile ? (
                            <MobileHeader
                                handleLogoClick={() => setSidebarOpen(true)}
                            />
                        ) : (
                            <div className="flex items-center space-x-1 sm:space-x-2 ml-auto">
                                {mounted ? (
                                    <>
                                        <ThemeToggle />
                                        <LanguageToggle />
                                    </>
                                ) : (
                                    // プレースホルダー（hydration前）
                                    <>
                                        <div className="w-8 h-8"></div>
                                        <div className="w-8 h-8"></div>
                                    </>
                                )}
                            </div>
                        )}
                    </header>

                    {/* 🔧 重要: childrenは常に同じ場所にマウント */}
                    <main className="flex-1 flex flex-col">{children}</main>
                </div>
            </div>
        </>
    )
}