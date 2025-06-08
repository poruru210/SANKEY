"use client"

import {useState} from "react"
import {useRouter, usePathname} from "next/navigation"
import {Button} from "@/components/ui/button"
import {Shield, FileKey, Settings, LogOut, Loader2, AlertTriangle} from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import {useSession} from 'next-auth/react'
import {signOutCompletely} from '@/lib/auth-actions'

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface SidebarProps {
    isMobile: boolean
    sidebarOpen: boolean
    setSidebarOpen: (open: boolean) => void
}

export function Sidebar({
                            isMobile,
                            sidebarOpen,
                            setSidebarOpen,
                        }: SidebarProps) {
    const t = useTranslations()
    const router = useRouter()
    const pathname = usePathname()
    const {data: session, status} = useSession()
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const [showLogoutDialog, setShowLogoutDialog] = useState(false)
    const [hoveredItem, setHoveredItem] = useState<string | null>(null)

    const handleNav = (path: string) => {
        router.push(path)
        if (isMobile) setSidebarOpen(false)
    }

    const isActive = (path: string) => pathname === path

    const handleLogoutClick = () => {
        setShowLogoutDialog(true)
    }

    const handleLogoutConfirm = async () => {
        if (isLoggingOut) return

        setIsLoggingOut(true)
        setShowLogoutDialog(false)
        try {
            await signOutCompletely()
        } catch (error) {
            console.error('Sidebar logout error:', error)
            alert(t("logout.error"))
            setIsLoggingOut(false)
        }
    }

    const isProcessing = isLoggingOut

    // デスクトップでのサイドバー折りたたみ処理
    const handleToggleSidebar = () => {
        setSidebarOpen(!sidebarOpen)
    }

    return (
        <>
            {/* 微細なパルス用のカスタムCSS */}
            <style jsx>{`
                @keyframes subtlePulse {
                    0%, 100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                    50% {
                        transform: scale(1.02);
                        opacity: 0.95;
                    }
                }

                .subtle-pulse {
                    animation: subtlePulse 3s ease-in-out infinite;
                }

                .subtle-pulse:hover {
                    animation-play-state: paused;
                    transform: scale(1.05);
                }

                @keyframes subtleGlow {
                    0%, 100% {
                        box-shadow: 0 0 5px rgba(16, 185, 129, 0.3);
                    }
                    50% {
                        box-shadow: 0 0 15px rgba(16, 185, 129, 0.5);
                    }
                }

                .subtle-glow {
                    animation: subtleGlow 3s ease-in-out infinite;
                }

                .subtle-glow:hover {
                    animation-play-state: paused;
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateX(-5px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                .tooltip-enter {
                    animation: slideIn 0.15s ease-out;
                }
            `}</style>

            {/* サイドバー本体 */}
            <div
                className={`${
                    isMobile
                        ? `fixed inset-y-0 left-0 z-50 w-64 theme-card-bg backdrop-blur-md border-r border-emerald-500/20 transform transition-transform duration-300 ease-in-out ${
                            sidebarOpen ? "translate-x-0" : "-translate-x-full"
                        }`
                        : `${sidebarOpen ? 'w-64' : 'w-16'} theme-card-bg backdrop-blur-md border-r border-emerald-500/20 flex-shrink-0 transition-all duration-300 ease-in-out fixed inset-y-0 left-0 z-40`
                }`}
            >
                <div className="flex flex-col h-full">
                    {/* Logo Section */}
                    {!isMobile && (
                        <div className="p-2 border-b border-emerald-500/20">
                            <div className="relative">
                                <div
                                    className={`w-full cursor-pointer transition-all duration-300 hover:bg-emerald-500/10 rounded-lg py-1 px-2`}
                                    onClick={handleToggleSidebar}
                                >
                                    {sidebarOpen ? (
                                        <div className="flex items-center justify-center space-x-0.5 h-10">
                                            <div className="flex items-center justify-center w-10 h-10 flex-shrink-0">
                                                <Image
                                                    src="/sankey-logo.svg"
                                                    alt="SANKEY Logo"
                                                    width={32}
                                                    height={32}
                                                    className="w-8 h-8"
                                                />
                                            </div>
                                            <h1 className="text-lg font-medium text-white tracking-widest">SANKEY</h1>
                                        </div>
                                    ) : (
                                        <div className="flex justify-center">
                                            <div
                                                className="flex items-center justify-center w-10 h-10 bg-emerald-500/10 rounded-lg border border-emerald-400/20 flex-shrink-0 subtle-pulse subtle-glow">
                                                <Image
                                                    src="/sankey-logo.svg"
                                                    alt="SANKEY Logo"
                                                    width={32}
                                                    height={32}
                                                    className="w-8 h-8"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Navigation */}
                    <nav
                        className={`flex-1 overflow-y-auto space-y-2 ${sidebarOpen ? 'p-4' : 'p-2'} transition-all duration-300`}>
                        <div className="relative">
                            <Button
                                variant="ghost"
                                className={`w-full h-12 ${sidebarOpen ? 'justify-start px-4' : 'justify-center px-0'} ${
                                    isActive("/")
                                        ? "bg-emerald-500/20 theme-text-primary hover:bg-emerald-500/30"
                                        : "theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20"
                                } transition-all duration-300`}
                                onClick={() => handleNav("/")}
                                disabled={isProcessing}
                                onMouseEnter={() => setHoveredItem(!sidebarOpen ? 'dashboard' : null)}
                                onMouseLeave={() => setHoveredItem(null)}
                            >
                                <Shield className="w-6 h-6 flex-shrink-0"/>
                                {sidebarOpen && <span className="ml-3">{t("nav.dashboard")}</span>}
                            </Button>
                        </div>

                        <div className="relative">
                            <Button
                                variant="ghost"
                                className={`w-full h-12 ${sidebarOpen ? 'justify-start px-4' : 'justify-center px-0'} ${
                                    isActive("/developer")
                                        ? "bg-emerald-500/20 theme-text-primary hover:bg-emerald-500/30"
                                        : "theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20"
                                } transition-all duration-300`}
                                onClick={() => handleNav("/developer")}
                                disabled={isProcessing}
                                onMouseEnter={() => setHoveredItem(!sidebarOpen ? 'developer' : null)}
                                onMouseLeave={() => setHoveredItem(null)}
                            >
                                <FileKey className="w-6 h-6 flex-shrink-0"/>
                                {sidebarOpen && <span className="ml-3">{t("nav.developer")}</span>}
                            </Button>
                        </div>

                        <div className="relative">
                            <Button
                                variant="ghost"
                                className={`w-full h-12 ${sidebarOpen ? 'justify-start px-4' : 'justify-center px-0'} ${
                                    isActive("/settings")
                                        ? "bg-emerald-500/20 theme-text-primary hover:bg-emerald-500/30"
                                        : "theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20"
                                } transition-all duration-300`}
                                onClick={() => handleNav("/settings")}
                                disabled={isProcessing}
                                onMouseEnter={() => setHoveredItem(!sidebarOpen ? 'settings' : null)}
                                onMouseLeave={() => setHoveredItem(null)}
                            >
                                <Settings className="w-6 h-6 flex-shrink-0"/>
                                {sidebarOpen && <span className="ml-3">{t("nav.settings")}</span>}
                            </Button>
                        </div>
                    </nav>

                    {/* Footer */}
                    <div
                        className={`border-t border-emerald-500/20 ${sidebarOpen ? 'p-4' : 'p-2'} transition-all duration-300`}>
                        <div className="relative">
                            <Button
                                variant="ghost"
                                className={`w-full h-12 ${sidebarOpen ? 'justify-start px-4' : 'justify-center px-0'} theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20 transition-all duration-300`}
                                onClick={handleLogoutClick}
                                disabled={isProcessing}
                                onMouseEnter={() => setHoveredItem(!sidebarOpen ? 'logout' : null)}
                                onMouseLeave={() => setHoveredItem(null)}
                            >
                                {isLoggingOut ? (
                                    <Loader2 className="w-6 h-6 animate-spin flex-shrink-0"/>
                                ) : (
                                    <LogOut className="w-6 h-6 flex-shrink-0"/>
                                )}
                                {sidebarOpen && (
                                    <span className="ml-3">
                                        {isLoggingOut ? t("logout.loggingOut") : t("nav.signOut")}
                                    </span>
                                )}
                            </Button>
                        </div>
                    </div>

                </div>
            </div>

            {/* カスタムツールチップ */}
            {hoveredItem && !sidebarOpen && (
                <div
                    className="fixed z-50 pointer-events-none"
                    style={{
                        left: '68px', // サイドバー幅(64px) + 少しの余白
                        top: hoveredItem === 'logo' ? '12px' :
                            hoveredItem === 'dashboard' ? '80px' :
                                hoveredItem === 'developer' ? '136px' :
                                    hoveredItem === 'settings' ? '192px' :
                                        hoveredItem === 'logout' ? 'calc(100vh - 80px)' : '0px'
                    }}
                >
                    <div
                        className="bg-slate-800/90 backdrop-blur-sm border border-slate-600/40 rounded-md px-2 py-1 shadow-md tooltip-enter">
                        <div className="text-slate-200 text-xs font-normal whitespace-nowrap">
                            {hoveredItem === 'logo' && (sidebarOpen ? t("nav.collapse") : t("nav.expand"))}
                            {hoveredItem === 'dashboard' && t("nav.dashboard")}
                            {hoveredItem === 'developer' && t("nav.developer")}
                            {hoveredItem === 'settings' && t("nav.settings")}
                            {hoveredItem === 'logout' && (isLoggingOut ? t("logout.loggingOut") : t("nav.signOut"))}
                        </div>
                        <div className="absolute left-0 top-1/2 transform -translate-x-0.5 -translate-y-1/2">
                            <div
                                className="w-1.5 h-1.5 bg-slate-800/90 border-l border-b border-slate-600/40 rotate-45"></div>
                        </div>
                    </div>
                </div>
            )}

            {/* Overlay for mobile */}
            {isMobile && sidebarOpen && (
                <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)}/>
            )}

            {/* ログアウト確認ダイアログ */}
            <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
                <AlertDialogContent className="theme-dialog-bg border-emerald-500/20">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="theme-text-primary flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-2 text-amber-400"/>
                            {t("logout.confirmTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="theme-text-secondary">
                            {t("logout.confirmMessage")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            className="border-emerald-500/40 theme-text-secondary hover:bg-emerald-500/20"
                            disabled={isLoggingOut}
                        >
                            {t("actions.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleLogoutConfirm}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={isLoggingOut}
                        >
                            {isLoggingOut ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin"/>
                                    {t("logout.loggingOut")}
                                </>
                            ) : (
                                <>
                                    <LogOut className="w-4 h-4 mr-2"/>
                                    {t("nav.signOut")}
                                </>
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}