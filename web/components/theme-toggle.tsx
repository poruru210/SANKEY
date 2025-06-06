"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme-context"
import { useEffect, useState } from "react"

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // クライアントサイドでマウントされるまで待つ
  useEffect(() => {
    setMounted(true)
  }, [])

  // マウントされるまではプレースホルダーを表示
  if (!mounted) {
    return (
        <Button
            variant="ghost"
            size="sm"
            className="theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20 focus:theme-text-primary focus:bg-emerald-500/20"
        >
          <div className="w-4 h-4" />
          <span className="sr-only">Toggle theme</span>
        </Button>
    )
  }

  return (
      <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="theme-text-secondary hover:theme-text-primary hover:bg-emerald-500/20 focus:theme-text-primary focus:bg-emerald-500/20"
      >
        {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        <span className="sr-only">Toggle theme</span>
      </Button>
  )
}