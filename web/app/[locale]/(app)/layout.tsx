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

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const checkMobile = () => {
            const mobile = window.innerWidth < 1024
            setIsMobile(mobile)

            if (mobile) {
                setSidebarOpen(false)
            } else {
                const savedState = localStorage.getItem('sidebar-open')
                setSidebarOpen(savedState !== null ? JSON.parse(savedState) : true)
            }
        }

        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    useEffect(() => {
        if (!isMobile && mounted) {
            localStorage.setItem('sidebar-open', JSON.stringify(sidebarOpen))
        }
    }, [sidebarOpen, isMobile, mounted])

    return (
        <>
            {mounted && <ParticlesBackground theme={(theme as "light" | "dark") || "dark"} />}

            <div className="min-h-screen flex relative z-0">
                {mounted ? (
                    <Sidebar
                        setSidebarOpen={setSidebarOpen}
                        sidebarOpen={sidebarOpen}
                        isMobile={isMobile}
                    />
                ) : (
                    <div className="w-0" />
                )}

                <div
                    className={`flex-1 flex flex-col min-w-0 relative z-10 transition-all duration-300 ease-in-out ${
                        mounted
                            ? isMobile
                                ? 'ml-0'
                                : sidebarOpen
                                    ? 'ml-64'
                                    : 'ml-16'
                            : 'ml-0'
                    }`}
                >
                    {mounted && isMobile ? (
                        <header className="fixed top-0 left-0 w-full h-16 z-50 bg-background border-b border-border">
                            <MobileHeader handleLogoClick={() => setSidebarOpen(true)} />
                        </header>
                    ) : (
                        <header className="flex justify-between items-center p-4 h-16">
                            <div className="flex items-center space-x-1 sm:space-x-2 ml-auto">
                                {mounted ? (
                                    <>
                                        <ThemeToggle />
                                        <LanguageToggle />
                                    </>
                                ) : (
                                    <>
                                        <div className="w-8 h-8"></div>
                                        <div className="w-8 h-8"></div>
                                    </>
                                )}
                            </div>
                        </header>
                    )}
                    <main className={`flex-1 flex flex-col ${mounted && isMobile ? 'pt-16' : 'pt-0'}`}>
                        {children}
                    </main>
                </div>
            </div>
        </>
    )
}
