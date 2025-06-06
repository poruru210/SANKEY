"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { usePlayground } from "@/hooks/use-developer"
import { licenseService } from "@/lib/services/license.service"
import {
  Key,
  Shield,
  Copy,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Calendar,
  User,
  Settings,
  ArrowRight,
  RefreshCw,
  Zap,
  Lock,
  Unlock,
  Info,
  FlaskConical,
} from "lucide-react"

export default function LicensePlayground() {
  const { toast } = useToast()
  const {
    encryptedLicense,
    isEncrypting,
    encryptError,
    generateLicense,
    resetEncryption,
    decryptedLicense,
    isDecrypting,
    decryptError,
    validateLicense,
    resetDecryption,
    resetAll,
  } = usePlayground()

  // Form states
  const [encryptForm, setEncryptForm] = useState({
    eaName: "",
    accountId: "",
    expiryDays: 365, // 日数で管理
  })

  // 有効期限を計算する関数
  const calculateExpiryDate = (days: number) => {
    const now = new Date()
    const expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return expiryDate.toISOString()
  }

  // プリセット期限
  const expiryPresets = [
    { label: "7日", days: 7 },
    { label: "30日", days: 30 },
    { label: "90日", days: 90 },
    { label: "1年", days: 365 },
    { label: "2年", days: 730 },
    { label: "無期限", days: 36000 },
  ]

  const [decryptForm, setDecryptForm] = useState({
    encryptedLicense: "",
    accountId: "",
  })

  // UI states
  const [showEncryptedLicense, setShowEncryptedLicense] = useState(false)
  const [showDecryptedPayload, setShowDecryptedPayload] = useState(true)
  const [activeTab, setActiveTab] = useState("generate")

  // License generation
  const handleGenerateLicense = async () => {
    if (!encryptForm.eaName.trim() || !encryptForm.accountId.trim()) {
      toast({
        title: "入力エラー",
        description: "EA名とアカウントIDは必須です",
        variant: "destructive",
      })
      return
    }

    try {
      await generateLicense({
        eaName: encryptForm.eaName.trim(),
        accountId: encryptForm.accountId.trim(),
        expiry: calculateExpiryDate(encryptForm.expiryDays),
      })

      toast({
        title: "ライセンスを生成しました",
        description: "暗号化されたライセンスキーが生成されました",
        variant: "default",
      })
    } catch (error) {
      // エラーは既にhookで処理されているので、ここでは追加処理のみ
      console.error("License generation failed:", error)
    }
  }

  // License validation
  const handleValidateLicense = async () => {
    if (!decryptForm.encryptedLicense.trim() || !decryptForm.accountId.trim()) {
      toast({
        title: "入力エラー",
        description: "ライセンスキーとアカウントIDは必須です",
        variant: "destructive",
      })
      return
    }

    try {
      await validateLicense({
        encryptedLicense: decryptForm.encryptedLicense.trim(),
        accountId: decryptForm.accountId.trim(),
      })

      toast({
        title: "ライセンスを検証しました",
        description: "ライセンス情報が復号化されました",
        variant: "default",
      })
    } catch (error) {
      console.error("License validation failed:", error)
    }
  }

  // Copy functionality
  const handleCopyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: "コピーしました",
        description: `${label}がクリップボードにコピーされました`,
        variant: "default",
      })
    } catch (error) {
      toast({
        title: "コピーに失敗しました",
        description: "クリップボードへのアクセスに失敗しました",
        variant: "destructive",
      })
    }
  }

  // Use generated license in validation form
  const handleUseGeneratedLicense = () => {
    if (encryptedLicense?.encryptedLicense) {
      setDecryptForm((prev) => ({
        ...prev,
        encryptedLicense: encryptedLicense.encryptedLicense,
        accountId: encryptForm.accountId,
      }))
      setActiveTab("validate")
      toast({
        title: "ライセンスを設定しました",
        description: "生成されたライセンスが検証フォームに設定されました",
        variant: "default",
      })
    }
  }

  // License status check
  const getLicenseStatus = (): {
    status: 'expired' | 'warning' | 'valid',
    label: string,
    color: 'destructive' | 'secondary' | 'default',
    days: number
  } | null => {
    if (!decryptedLicense?.decryptedLicense) return null

    const isExpired = licenseService.isLicenseExpired(decryptedLicense.decryptedLicense)
    const daysUntilExpiry = licenseService.getDaysUntilExpiry(decryptedLicense.decryptedLicense)

    if (isExpired) {
      return { status: 'expired', label: '期限切れ', color: 'destructive', days: daysUntilExpiry }
    } else if (daysUntilExpiry <= 30) {
      return { status: 'warning', label: '期限間近', color: 'secondary', days: daysUntilExpiry }
    } else {
      return { status: 'valid', label: '有効', color: 'default', days: daysUntilExpiry }
    }
  }

  const licenseStatus = getLicenseStatus()

  return (
      <div>
        <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <FlaskConical className="w-6 h-6 mr-2 text-emerald-400"/>
                <CardTitle className="theme-text-primary">Playground</CardTitle>
              </div>
              <Button
                  variant="outline"
                  onClick={resetAll}
                  className="flex items-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>リセット</span>
              </Button>
            </div>
            <CardDescription className="theme-text-secondary">
              ライセンスの生成と検証をテストできます
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 theme-card-bg border border-emerald-500/20 p-1 rounded-lg overflow-hidden mb-8">
                <TabsTrigger
                    value="generate"
                    className="data-[state=active]:bg-[var(--tab-active-bg)] data-[state=active]:text-[var(--tab-active-text)] data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 text-[var(--tab-inactive-text)] hover:text-[var(--tab-inactive-hover-text)] hover:bg-[var(--tab-inactive-hover-bg)] transition-all duration-200 text-xs sm:text-sm rounded-l-md rounded-r-none m-0"
                >
                  <Key className="w-4 h-4 mr-1 sm:mr-2"/>
                  <span>ライセンス生成</span>
                </TabsTrigger>
                <TabsTrigger
                    value="validate"
                    className="data-[state=active]:bg-[var(--tab-active-bg)] data-[state=active]:text-[var(--tab-active-text)] data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 text-[var(--tab-inactive-text)] hover:text-[var(--tab-inactive-hover-text)] hover:bg-[var(--tab-inactive-hover-bg)] transition-all duration-200 text-xs sm:text-sm rounded-r-md rounded-l-none m-0"
                >
                  <Shield className="w-4 h-4 mr-1 sm:mr-2"/>
                  <span>ライセンス検証</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="space-y-6">
                <Card className="theme-card-bg border-emerald-500/20">
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Generation Form */}
                      <div className="space-y-6">
                        <div className="flex items-center space-x-3 mb-6">
                          <Key className="w-6 h-6 text-emerald-400"/>
                          <div>
                            <h4 className="font-semibold theme-text-primary mb-2">新しいライセンスを生成</h4>
                            <p className="text-sm text-muted-foreground">EA情報を入力してライセンスキーを生成します</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="eaName" className="theme-text-primary">EA名 *</Label>
                            <Input
                                id="eaName"
                                placeholder="MyTradingEA v1.0"
                                value={encryptForm.eaName}
                                onChange={(e) => setEncryptForm((prev) => ({ ...prev, eaName: e.target.value }))}
                                className="theme-input"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="accountId" className="theme-text-primary">アカウントID *</Label>
                            <Input
                                id="accountId"
                                placeholder="1234567890"
                                value={encryptForm.accountId}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[^0-9]/g, '')
                                  setEncryptForm((prev) => ({ ...prev, accountId: value }))
                                }}
                                className="theme-input"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="expiryDays" className="theme-text-primary">有効期限（日数）</Label>

                            {/* プリセットボタン */}
                            <div className="flex flex-wrap gap-2 mb-3">
                              {expiryPresets.map((preset) => (
                                  <button
                                      key={preset.days}
                                      onClick={() => setEncryptForm((prev) => ({
                                        ...prev,
                                        expiryDays: preset.days
                                      }))}
                                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                          encryptForm.expiryDays === preset.days
                                              ? 'bg-emerald-500 text-white'
                                              : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                      }`}
                                  >
                                    {preset.label}
                                  </button>
                              ))}
                            </div>

                            <Input
                                id="expiryDays"
                                type="number"
                                placeholder="365"
                                min="1"
                                max="3650"
                                value={encryptForm.expiryDays}
                                onChange={(e) => setEncryptForm((prev) => ({
                                  ...prev,
                                  expiryDays: parseInt(e.target.value) || 365
                                }))}
                                className="theme-input"
                            />
                            <p className="text-xs theme-text-secondary">
                              期限: {new Date(calculateExpiryDate(encryptForm.expiryDays)).toLocaleDateString('ja-JP')}
                            </p>
                          </div>
                        </div>

                        <Button
                            onClick={handleGenerateLicense}
                            disabled={isEncrypting}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                        >
                          {isEncrypting ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                生成中...
                              </>
                          ) : (
                              <>
                                <Key className="w-4 h-4 mr-2" />
                                ライセンス生成
                              </>
                          )}
                        </Button>

                        {encryptError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                              <div className="flex items-center text-red-400">
                                <AlertCircle className="w-4 h-4 mr-2"/>
                                <span className="font-medium">エラー</span>
                              </div>
                              <p className="text-sm text-red-300 mt-1">{encryptError}</p>
                            </div>
                        )}
                      </div>

                      {/* Generated License Display */}
                      <div className="space-y-6">
                        <div className="flex items-center space-x-3 mb-6">
                          <Lock className="w-6 h-6 text-blue-400"/>
                          <div>
                            <h4 className="font-semibold theme-text-primary mb-2">生成されたライセンス</h4>
                            <p className="text-sm text-muted-foreground">暗号化されたライセンスキー</p>
                          </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                          {encryptedLicense ? (
                              <>
                                <div className="flex items-center justify-between mb-4">
                                  <Label className="text-sm font-medium theme-text-primary">ライセンスキー</Label>
                                  <div className="flex space-x-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowEncryptedLicense(!showEncryptedLicense)}
                                    >
                                      {showEncryptedLicense ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCopyToClipboard(encryptedLicense.encryptedLicense, "ライセンスキー")}
                                    >
                                      <Copy className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>

                                <Textarea
                                    value={
                                      showEncryptedLicense
                                          ? encryptedLicense.encryptedLicense
                                          : "••••••••••••••••••••••••••••••••••••••••••••••••••••"
                                    }
                                    readOnly
                                    className="theme-textarea font-mono text-sm"
                                    rows={4}
                                />

                                <div className="mt-4 flex justify-center">
                                  <Button
                                      onClick={handleUseGeneratedLicense}
                                      variant="outline"
                                      className="flex items-center space-x-2"
                                  >
                                    <span>検証フォームで使用</span>
                                    <ArrowRight className="w-4 h-4" />
                                  </Button>
                                </div>
                              </>
                          ) : (
                              <div className="text-center py-12">
                                <Lock className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="theme-text-secondary">
                                  ライセンスを生成してください
                                </p>
                              </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="validate" className="space-y-6">
                <Card className="theme-card-bg border-emerald-500/20">
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Validation Form */}
                      <div className="space-y-6">
                        <div className="flex items-center space-x-3 mb-6">
                          <Shield className="w-6 h-6 text-blue-400"/>
                          <div>
                            <h4 className="font-semibold theme-text-primary mb-2">ライセンスを検証</h4>
                            <p className="text-sm text-muted-foreground">ライセンスキーを入力して内容を確認します</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="licenseKey" className="theme-text-primary">ライセンスキー *</Label>
                            <Textarea
                                id="licenseKey"
                                placeholder="暗号化されたライセンス文字列を入力してください"
                                value={decryptForm.encryptedLicense}
                                onChange={(e) => setDecryptForm((prev) => ({ ...prev, encryptedLicense: e.target.value }))}
                                className="theme-textarea font-mono text-sm"
                                rows={4}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="validationAccountId" className="theme-text-primary">アカウントID *</Label>
                            <Input
                                id="validationAccountId"
                                placeholder="1234567890"
                                value={decryptForm.accountId}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[^0-9]/g, '')
                                  setDecryptForm((prev) => ({ ...prev, accountId: value }))
                                }}
                                className="theme-input"
                            />
                          </div>
                        </div>

                        <Button
                            onClick={handleValidateLicense}
                            disabled={isDecrypting}
                            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                        >
                          {isDecrypting ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                検証中...
                              </>
                          ) : (
                              <>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                ライセンス検証
                              </>
                          )}
                        </Button>

                        {decryptError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                              <div className="flex items-center text-red-400">
                                <AlertCircle className="w-4 h-4 mr-2"/>
                                <span className="font-medium">検証失敗</span>
                              </div>
                              <p className="text-sm text-red-300 mt-1">{decryptError}</p>
                            </div>
                        )}
                      </div>

                      {/* License Information Display */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center space-x-3">
                            <Unlock className="w-6 h-6 text-green-400"/>
                            <div>
                              <h4 className="font-semibold theme-text-primary mb-2">ライセンス情報</h4>
                              <p className="text-sm text-muted-foreground">復号化されたライセンス詳細</p>
                            </div>
                          </div>
                          {licenseStatus && (
                              <Badge variant={licenseStatus.color}>
                                {licenseStatus.label}
                                {licenseStatus.days > 0 && ` (${licenseStatus.days}日)`}
                              </Badge>
                          )}
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                          {decryptedLicense ? (
                              showDecryptedPayload ? (
                                  <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <Label className="text-xs theme-text-secondary">EA名</Label>
                                        <p className="theme-text-primary font-mono">{decryptedLicense.decryptedLicense.eaName}</p>
                                      </div>
                                      <div>
                                        <Label className="text-xs theme-text-secondary">アカウントID</Label>
                                        <p className="theme-text-primary font-mono">{decryptedLicense.decryptedLicense.accountId}</p>
                                      </div>
                                      <div>
                                        <Label className="text-xs theme-text-secondary">有効期限</Label>
                                        <p className="theme-text-primary font-mono">
                                          {new Date(decryptedLicense.decryptedLicense.expiry).toLocaleString('ja-JP')}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs theme-text-secondary">発行日時</Label>
                                        <p className="theme-text-primary font-mono">
                                          {new Date(decryptedLicense.decryptedLicense.issuedAt).toLocaleString('ja-JP')}
                                        </p>
                                      </div>
                                    </div>

                                    <Separator />

                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <Label className="text-sm font-medium theme-text-primary">JSON表示</Label>
                                        <div className="flex space-x-2">
                                          <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => setShowDecryptedPayload(!showDecryptedPayload)}
                                          >
                                            <EyeOff className="w-4 h-4" />
                                          </Button>
                                          <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() =>
                                                  handleCopyToClipboard(
                                                      JSON.stringify(decryptedLicense.decryptedLicense, null, 2),
                                                      "ライセンス情報",
                                                  )
                                              }
                                          >
                                            <Copy className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </div>
                                      <Textarea
                                          value={JSON.stringify(decryptedLicense.decryptedLicense, null, 2)}
                                          readOnly
                                          className="theme-textarea font-mono text-sm"
                                          rows={8}
                                      />
                                    </div>
                                  </div>
                              ) : (
                                  <div className="text-center py-12">
                                    <Eye className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                    <p className="theme-text-secondary mb-4">
                                      ライセンス情報は非表示になっています
                                    </p>
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowDecryptedPayload(true)}
                                    >
                                      <Eye className="w-4 h-4 mr-2" />
                                      表示する
                                    </Button>
                                  </div>
                              )
                          ) : (
                              <div className="text-center py-12">
                                <Unlock className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <p className="theme-text-secondary">
                                  ライセンスを検証してください
                                </p>
                              </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
  )
}