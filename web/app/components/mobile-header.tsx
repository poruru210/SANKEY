"use client"

import Image from "next/image"
import {ThemeToggle} from "@/components/theme-toggle";
import {LanguageToggle} from "@/components/language-toggle";
import React from "react";

interface MobileHeaderProps {
    handleLogoClick: () => void
}

export function MobileHeader({ handleLogoClick }: MobileHeaderProps) {
    return (
        <header className="theme-bg-gradient border-b  relative z-10">
            <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
                        <div
                            className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-emerald-500/10 rounded-lg border border-emerald-400/20 flex-shrink-0 cursor-pointer hover:bg-emerald-500/20 transition-colors"
                            onClick={handleLogoClick}
                        >
                            <Image src="/sankey-logo.svg" alt="SANKEY Logo" width={32} height={32} className="w-6 h-6 sm:w-8 sm:h-8" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-lg font-medium text-white tracking-widest">SANKEY</h1>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
                        <ThemeToggle />
                        <LanguageToggle />
                    </div>
                </div>
            </div>
        </header>
    )
}