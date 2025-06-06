"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Download, FileCode, Settings, CheckCircle, AlertCircle } from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl";

interface ModuleInfo {
  name: string
  description: string
  filename: string
  size: string
  version: string
  icon: React.ReactNode
  downloadUrl: string
  requirements: string[]
  checksum: string
}

export function ModuleDownload() {
  const t = useTranslations('developer.moduleDownload');
  const [downloadedModules, setDownloadedModules] = useState<string[]>([])

  const modules: ModuleInfo[] = [
    {
      name: t('mqh.name'),
      description: t('mqh.description'),
      filename: t('mqh.fileName'),
      size: "12.5 KB", // This could be dynamic or also translated if needed
      version: "v2.1.0", // This could be dynamic
      icon: <FileCode className="w-5 h-5 text-blue-400" />,
      downloadUrl: "/downloads/SANKEY_License.mqh",
      requirements: [
        t('mqh.requirements.mt5'),
        t('mqh.requirements.mql5Compiler'),
        t('mqh.requirements.includeFolder')
      ],
      checksum: "SHA256: a1b2c3d4e5f6789...", // This should be dynamic
    },
    {
      name: t('dll.name'),
      description: t('dll.description'),
      filename: t('dll.fileName'),
      size: "245 KB", // Dynamic
      version: "v2.1.0", // Dynamic
      icon: <Settings className="w-5 h-5 text-purple-400" />,
      downloadUrl: "/downloads/SANKEY_License.dll",
      requirements: [
        t('dll.requirements.windows'),
        t('dll.requirements.vcRedist'),
        t('dll.requirements.librariesFolder')
      ],
      checksum: "SHA256: f6e5d4c3b2a1098...", // Dynamic
    },
  ]

  const handleDownload = (module: ModuleInfo) => {
    // 実際のダウンロード処理をシミュレート
    const link = document.createElement("a")
    link.href = module.downloadUrl
    link.download = module.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // ダウンロード済みとしてマーク
    setDownloadedModules((prev) => [...prev, module.filename])
  }

  const isDownloaded = (filename: string) => downloadedModules.includes(filename)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {modules.map((module) => (
          <Card key={module.filename} className="theme-card-bg border-emerald-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {module.icon}
                  <CardTitle className="theme-text-primary text-lg">{module.name}</CardTitle>
                </div>
                {isDownloaded(module.filename) && (
                  <Badge className="bg-emerald-500 text-white">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {t('status.downloaded')}
                  </Badge>
                )}
              </div>
              <CardDescription className="theme-text-secondary">{module.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* ファイル情報 */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">{t('labels.fileName')}:</span>
                  <span className="theme-text-primary font-mono">{module.filename}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">{t('labels.size')}:</span>
                  <span className="theme-text-primary">{module.size}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="theme-text-secondary">{t('labels.version')}:</span>
                  <span className="theme-text-primary">{module.version}</span>
                </div>
              </div>

              {/* 要件 */}
              <div>
                <h5 className="text-sm font-medium theme-text-primary mb-2">{t('labels.requirements')}</h5>
                <ul className="space-y-1">
                  {module.requirements.map((req, index) => (
                    <li key={index} className="flex items-start space-x-2">
                      <AlertCircle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
                      <span className="text-xs theme-text-secondary">{req}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* チェックサム */}
              <div className="text-xs theme-text-muted font-mono bg-slate-900/50 p-2 rounded">{module.checksum}</div>

              {/* ダウンロードボタン */}
              <Button
                onClick={() => handleDownload(module)}
                className={`w-full ${
                  isDownloaded(module.filename)
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-emerald-500 hover:bg-emerald-600"
                } text-white`}
                disabled={isDownloaded(module.filename)}
              >
                <Download className="w-4 h-4 mr-2" />
                {isDownloaded(module.filename) ? t('buttons.downloadCompleted') : t('buttons.download')}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* インストール手順 */}
      <Card className="theme-card-bg border-emerald-500/20">
        <CardHeader>
          <CardTitle className="theme-text-primary text-lg">{t('installation.title')}</CardTitle>
          <CardDescription className="theme-text-secondary">
            {t('installation.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* MQH配置手順 */}
            <div className="space-y-3">
              <h5 className="font-medium theme-text-primary flex items-center">
                <FileCode className="w-4 h-4 mr-2 text-blue-400" />
                {t('installation.mqh.title')}
              </h5>
              <div className="space-y-2 text-sm">
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <span className="theme-text-secondary">{t('installation.mqh.step1')}</span>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <span className="theme-text-secondary">{t('installation.mqh.step2')}</span>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <span className="theme-text-secondary">{t('installation.mqh.step3')}</span>
                </div>
                <div className="bg-slate-900/50 p-2 rounded font-mono text-xs theme-text-muted">
                  {t('installation.mqh.path')}
                </div>
              </div>
            </div>

            {/* DLL配置手順 */}
            <div className="space-y-3">
              <h5 className="font-medium theme-text-primary flex items-center">
                <Settings className="w-4 h-4 mr-2 text-purple-400" />
                {t('installation.dll.title')}
              </h5>
              <div className="space-y-2 text-sm">
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <span className="theme-text-secondary">{t('installation.dll.step1')}</span>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <span className="theme-text-secondary">{t('installation.dll.step2')}</span>
                </div>
                <div className="flex items-start space-x-2">
                  <span className="bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <span className="theme-text-secondary">{t('installation.dll.step3')}</span>
                </div>
                <div className="bg-slate-900/50 p-2 rounded font-mono text-xs theme-text-muted">
                  {t('installation.dll.path')}
                </div>
              </div>
            </div>
          </div>

          {/* 重要な注意事項 */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <h6 className="font-medium theme-text-primary">{t('installation.importantNotes.title')}</h6>
                <ul className="space-y-1 text-sm theme-text-secondary">
                  <li>{t('installation.importantNotes.note1')}</li>
                  <li>{t('installation.importantNotes.note2')}</li>
                  <li>{t('installation.importantNotes.note3')}</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
