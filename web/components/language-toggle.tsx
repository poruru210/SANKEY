"use client"

import { Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n-context"

export function LanguageToggle() {
  const { language, setLanguage } = useI18n()

  return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
              variant="ghost"
              size="sm"
              className="theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20 focus:theme-text-primary focus:bg-emerald-500/20"
          >
            <Languages className="w-4 h-4" />
            <span className="sr-only">Change language</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="theme-dropdown-bg border-emerald-500/20">
          <DropdownMenuItem
              onClick={() => setLanguage("en")}
              className={`theme-text-primary hover:bg-emerald-500/20 ${language === "en" ? "bg-emerald-500/10" : ""}`}
          >
            English
          </DropdownMenuItem>
          <DropdownMenuItem
              onClick={() => setLanguage("ja")}
              className={`theme-text-primary hover:bg-emerald-500/20 ${language === "ja" ? "bg-emerald-500/10" : ""}`}
          >
            日本語
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
  )
}