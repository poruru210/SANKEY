"use client"

import Image from "next/image"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import React from "react"

interface MobileHeaderProps {
    handleLogoClick: () => void
}

export function MobileHeader({ handleLogoClick }: MobileHeaderProps) {
    return (
        <header className="fixed top-0 left-0 w-full h-16 z-50 bg-background border-b border-border">
            <div className="relative flex items-center justify-center h-full px-4 sm:px-6">

                {/* 左側: ロゴ＋テキスト */}
                <div className="absolute left-4 sm:left-6 flex items-center space-x-2 sm:space-x-3">
                    <div
                        onClick={handleLogoClick}
                        className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-emerald-500/10 rounded-lg border border-emerald-400/20 cursor-pointer hover:bg-emerald-500/20 transition-colors"
                    >
                        <Image
                            src="/sankey-logo.svg"
                            alt="SANKEY Logo"
                            width={40}
                            height={40}
                            className="w-8 h-8 sm:w-10 sm:h-10"
                        />
                    </div>
                    <h1 className="text-lg font-medium text-white tracking-widest">SANKEY</h1>
                </div>

                {/* 右側: テーマ・言語トグル */}
                <div className="absolute right-4 sm:right-6 flex items-center space-x-2 sm:space-x-4">
                    <ThemeToggle />
                    <LanguageToggle />
                </div>

                {/* 中央スペース（必要ならロゴなど） */}
                <div className="invisible sm:visible">
                    {/* 何も表示しないけど高さ保持のため */}
                    <span className="text-transparent">SANKEY</span>
                </div>
            </div>
        </header>
    )
}
