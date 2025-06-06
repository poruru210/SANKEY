"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"

interface CodeBlockProps {
  code: string
  language?: string
  title?: string
}

export function CodeBlock({ code, language = "cpp", title }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err)
      // フォールバック: 古いブラウザ対応
      const textArea = document.createElement("textarea")
      textArea.value = code
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="relative">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-slate-700/50 rounded-t-md">
          <span className="text-sm font-medium theme-text-secondary">{title}</span>
          <span className="text-xs theme-text-muted uppercase">{language}</span>
        </div>
      )}
      <div className="relative">
        <pre
          className={`bg-slate-800/40 p-4 ${title ? "rounded-b-md" : "rounded-md"} overflow-x-auto border border-emerald-500/10`}
        >
          <code className="text-xs theme-text-emerald font-mono leading-relaxed whitespace-pre">{code}</code>
        </pre>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="absolute top-2 right-2 h-8 w-8 p-0 theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
          title={copied ? "Copied!" : "Copy code"}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  )
}
