"use client"

import { Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRouter, usePathname } from "next/navigation"
import { useLocale } from "next-intl"
import { locales, type Locale } from "@/i18n/routing"

export function LanguageToggle() {
    const router = useRouter()
    const pathname = usePathname()
    const locale = useLocale() as Locale

    const switchLanguage = (newLocale: Locale) => {
        if (newLocale === locale) return;

        // Parse current path and replace locale
        const segments = pathname.split('/').filter(Boolean);

        if (segments.length > 0 && locales.includes(segments[0] as Locale)) {
            segments[0] = newLocale;
        } else {
            segments.unshift(newLocale);
        }

        const newPath = '/' + segments.join('/');
        router.push(newPath);
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20 focus:theme-text-primary focus:bg-emerald-500/20"
                >
                    <Languages className="w-4 h-4" />
                    <span className="sr-only">Change language ({locale})</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="theme-dropdown-bg border-emerald-500/20">
                <DropdownMenuItem
                    onClick={() => switchLanguage("en")}
                    className={`theme-text-primary hover:bg-emerald-500/20 ${locale === "en" ? "bg-emerald-500/10" : ""}`}
                >
                    English {locale === "en" ? "✓" : ""}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => switchLanguage("ja")}
                    className={`theme-text-primary hover:bg-emerald-500/20 ${locale === "ja" ? "bg-emerald-500/10" : ""}`}
                >
                    日本語 {locale === "ja" ? "✓" : ""}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}