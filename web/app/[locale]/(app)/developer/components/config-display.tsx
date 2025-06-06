"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Copy, Eye, EyeOff, User, Link, Key } from "lucide-react"

interface ConfigItem {
  label: string
  value: string
  icon: React.ReactNode
  copyable?: boolean
  secret?: boolean
}

export function ConfigDisplay() {
  const [showMasterKey, setShowMasterKey] = useState(false)
  const [copiedItem, setCopiedItem] = useState<string | null>(null)

  const configItems: ConfigItem[] = [
    {
      label: "ユーザーID",
      value: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      icon: <User className="w-4 h-4 text-emerald-400" />,
      copyable: true,
    },
    {
      label: "Webhook URL",
      value: "https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/applications/webhook",
      icon: <Link className="w-4 h-4 text-emerald-400" />,
      copyable: true,
    },
    {
      label: "マスターキー",
      value: "SANKEY-MASTER-2024-ABCD-EFGH-IJKL-MNOP-QRST",
      icon: <Key className="w-4 h-4 text-emerald-400" />,
      copyable: true,
      secret: true,
    },
  ]

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedItem(label)
      setTimeout(() => setCopiedItem(null), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <Card className="theme-card-bg border-emerald-500/20">
      <CardHeader>
        <CardTitle className="theme-text-primary text-lg">あなたの設定値</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {configItems.map((item) => (
          <div key={item.label} className="space-y-2">
            <label className="text-sm font-medium theme-text-secondary flex items-center">
              {item.icon}
              <span className="ml-2">{item.label}</span>
            </label>
            <div className="flex items-center space-x-2">
              <Input
                type={item.secret && !showMasterKey ? "password" : "text"}
                value={item.secret && !showMasterKey ? "••••••••••••••••••••••••••••••••••••••••" : item.value}
                readOnly
                className="flex-1 theme-input text-sm font-mono"
              />
              {item.secret && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMasterKey(!showMasterKey)}
                  className="h-10 w-10 p-0 theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
                >
                  {showMasterKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              )}
              {item.copyable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(item.value, item.label)}
                  className="h-10 w-10 p-0 theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              )}
            </div>
            {copiedItem === item.label && <p className="text-xs text-emerald-400">コピーしました！</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
