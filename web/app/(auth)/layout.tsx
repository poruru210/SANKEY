"use client"

import ParticlesBackground from "@/app/components/ParticlesBackground"
import {ThemeToggle} from "@/components/theme-toggle"
import {LanguageToggle} from "@/components/language-toggle"
import { useTheme } from "@/lib/theme-context"
import { useEffect, useState } from "react"

interface AuthLayoutProps {
    children: React.ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    const { resolvedTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    // マウントされるまでは基本的なレイアウトのみ表示
    if (!mounted) {
        return (
            <div className="min-h-screen flex flex-col relative z-10">
                <header className="flex justify-between items-center p-4">
                    <div className="flex items-center space-x-1 sm:space-x-2 ml-auto">
                        {/* プレースホルダー */}
                        <div className="w-9 h-9" />
                        <div className="w-9 h-9" />
                    </div>
                </header>
                <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
                    {children}
                </div>
                <div className="w-full text-center py-4">
                    <div className="text-xs theme-text-muted">© 2024 SANKEY. All rights reserved.</div>
                </div>
            </div>
        )
    }

    return (
        <>
            <ParticlesBackground theme={(resolvedTheme as "light" | "dark") || "dark"} />
            <div className="min-h-screen flex flex-col relative z-10">
                {/* Header */}
                <header className="flex justify-between items-center p-4">
                    <div className="flex items-center space-x-1 sm:space-x-2 ml-auto">
                        <ThemeToggle />
                        <LanguageToggle />
                    </div>
                </header>

                {/* Main Content */}
                <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
                    {children}
                </div>

                {/* Footer */}
                <div className="w-full text-center py-4">
                    <div className="text-xs theme-text-muted">© 2024 SANKEY. All rights reserved.</div>
                </div>
            </div>
        </>
    )
}