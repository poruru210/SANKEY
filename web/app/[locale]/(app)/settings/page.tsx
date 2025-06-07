"use client"

import React, {useState, useEffect} from "react"
import {Button} from "@/components/ui/button";
import {ArrowLeft, CheckCircle, Copy, FileKey, Key, Settings, Shield, Loader2} from "lucide-react";
import {ThemeToggle} from "@/components/theme-toggle";
import {LanguageToggle} from "@/components/language-toggle";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import {useTheme} from "next-themes";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { usePlan } from "@/hooks/use-plan";
import { PlanTier } from "@/lib/services/plan.service";

export default function SettingsPage() {
    const t = useTranslations()
    const { theme } = useTheme()

    // Plan API Hook
    const {
        planInfo,
        isLoading: planLoading,
        error: planError,
        getPlanInfo,
        changePlan,
        clearError,
        canUpgrade,
        canDowngrade,
        getUpgradeOptions,
        getDowngradeOptions,
        formatPlanName,
        formatPlanLimits
    } = usePlan()

    // Local states
    const [monthlyLicensesUsed] = useState(3) // TODO: EAアプリケーションから取得
    const [activeLicensesCount] = useState(5) // TODO: EAアプリケーションから取得
    const [licenseExpirationType, setLicenseExpirationType] = useState<"unlimited" | "custom">("custom")
    const [customExpirationDays, setCustomExpirationDays] = useState(365)
    const [masterKey, setMasterKey] = useState("SANKEY-MASTER-2024-ABCD-EFGH-IJKL-MNOP-QRST")
    const [planChangeDialog, setPlanChangeDialog] = useState(false)
    const [selectedPlan, setSelectedPlan] = useState<PlanTier | null>(null)
    const [isChangingPlan, setIsChangingPlan] = useState(false)

    // Settings states
    const [itemsPerPage, setItemsPerPage] = useState(10)

    // プラン情報を初期ロード
    useEffect(() => {
        getPlanInfo()
    }, [getPlanInfo])

    // 現在のプランを設定
    const currentTier = planInfo?.current.currentTier as PlanTier | null

    // API Calls使用量（プラン情報から計算）
    const apiCallsUsed = planInfo?.current.limits ?
        Math.floor(planInfo.current.limits.quotaLimit * 0.125) : // 12.5%使用と仮定
        0

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            console.log("License key copied to clipboard")
        } catch (err) {
            console.error("Failed to copy license key:", err)
            const textArea = document.createElement("textarea")
            textArea.value = text
            document.body.appendChild(textArea)
            textArea.select()
            document.execCommand("copy")
            document.body.removeChild(textArea)
        }
    }

    const handlePlanChange = async () => {
        if (!selectedPlan) return

        setIsChangingPlan(true)
        try {
            const result = await changePlan(selectedPlan)
            if (result) {
                console.log(`Plan changed from ${result.previousTier} to ${result.newTier}`)
                setPlanChangeDialog(false)
                setSelectedPlan(null)
            }
        } catch (error) {
            console.error('Plan change failed:', error)
        } finally {
            setIsChangingPlan(false)
        }
    }

    // ローディング状態
    if (planLoading && !planInfo) {
        return (
            <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                <div className="flex items-center justify-center min-h-[400px]">
                    <div className="text-center space-y-4">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-400" />
                        <p className="theme-text-secondary">Loading plan information...</p>
                    </div>
                </div>
            </main>
        )
    }

    // エラー状態
    if (planError) {
        return (
            <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                <Card className="theme-card-bg border-red-500/20">
                    <CardContent className="p-6">
                        <div className="text-center space-y-4">
                            <div className="text-red-400 text-lg font-semibold">Error loading plan information</div>
                            <p className="theme-text-secondary">{planError}</p>
                            <Button
                                onClick={() => {
                                    clearError()
                                    getPlanInfo()
                                }}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                Retry
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </main>
        )
    }

    return (
        <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
            {/* Settings Header */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                        <Settings className="w-8 h-8 text-emerald-400" />
                        <div>
                            <h2 className="text-3xl font-bold theme-text-primary">{t("settings.title")}</h2>
                            <p className="theme-text-secondary">{t("settings.subtitle")}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Settings Content */}
            <div className="w-full space-y-6">
                {/* Current Plan Card */}
                <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="theme-text-primary flex items-center">
                            <Shield className="w-5 h-5 mr-2 text-emerald-400" />
                            {t("settings.currentPlan")}
                        </CardTitle>
                        <CardDescription className="theme-text-secondary">{t("settings.planDescription")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Plan Status */}
                        <div className="flex items-center justify-between p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                            <div className="flex items-center space-x-3">
                                <div className="flex items-center justify-center w-12 h-12 bg-emerald-500/20 rounded-lg">
                                    <Key className="w-6 h-6 text-emerald-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold theme-text-primary">
                                        {currentTier ? formatPlanName(currentTier) : 'Unknown Plan'}
                                    </h3>
                                    <p className="text-sm theme-text-secondary">
                                        {planInfo?.current.limits ?
                                            formatPlanLimits(planInfo.current.limits) :
                                            'No plan limits available'
                                        }
                                    </p>
                                </div>
                            </div>
                            <Badge
                                className={`${
                                    currentTier === "free" ? "bg-gray-500" :
                                        currentTier === "basic" ? "bg-blue-500" :
                                            currentTier === "pro" ? "bg-purple-500" :
                                                "bg-gray-500"
                                } text-white`}
                            >
                                {currentTier ? formatPlanName(currentTier) : 'Unknown'}
                            </Badge>
                        </div>

                        {/* Usage Statistics */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Monthly Licenses */}
                            <div className="p-4 theme-card-bg rounded-lg border border-emerald-500/10">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm theme-text-secondary">{t("settings.monthlyLicenses")}</span>
                                    <FileKey className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div className="text-2xl font-bold theme-text-primary">{monthlyLicensesUsed}</div>
                                <div className="text-xs theme-text-muted">
                                    {t("settings.of")}{" "}
                                    {planInfo?.current.limits?.quotaLimit === -1 || !planInfo?.current.limits
                                        ? t("settings.unlimited")
                                        : planInfo.current.limits.quotaLimit}{" "}
                                    {t("settings.used")}
                                </div>
                                {planInfo?.current.limits && planInfo.current.limits.quotaLimit !== -1 && (
                                    <div className="mt-2 w-full bg-slate-700 rounded-full h-2">
                                        <div
                                            className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min((monthlyLicensesUsed / planInfo.current.limits.quotaLimit) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Active Licenses */}
                            <div className="p-4 theme-card-bg rounded-lg border border-emerald-500/10">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm theme-text-secondary">{t("settings.activeLicenses")}</span>
                                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div className="text-2xl font-bold theme-text-primary">{activeLicensesCount}</div>
                                <div className="text-xs theme-text-muted">
                                    {t("settings.of")}{" "}
                                    {t("settings.unlimited")}{" "}
                                    {t("settings.active")}
                                </div>
                            </div>

                            {/* API Calls */}
                            <div className="p-4 theme-card-bg rounded-lg border border-emerald-500/10">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm theme-text-secondary">{t("settings.apiCalls")}</span>
                                    <Settings className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div className="text-2xl font-bold theme-text-primary">{apiCallsUsed.toLocaleString()}</div>
                                <div className="text-xs theme-text-muted">
                                    {t("settings.of")}{" "}
                                    {planInfo?.current.limits?.quotaLimit === -1 || !planInfo?.current.limits
                                        ? t("settings.unlimited")
                                        : planInfo.current.limits.quotaLimit.toLocaleString()}{" "}
                                    {t("settings.thisMonth")}
                                </div>
                                {planInfo?.current.limits && planInfo.current.limits.quotaLimit !== -1 && (
                                    <div className="mt-2 w-full bg-slate-700 rounded-full h-2">
                                        <div
                                            className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min((apiCallsUsed / planInfo.current.limits.quotaLimit) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Plan Change Button */}
                        <div className="flex justify-center pt-4 border-t border-emerald-500/20">
                            <Button
                                onClick={() => setPlanChangeDialog(true)}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                disabled={planLoading}
                            >
                                {planLoading ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <Key className="w-4 h-4 mr-2" />
                                )}
                                {t("settings.changePlan")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* License Settings Card */}
                <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="theme-text-primary flex items-center">
                            <FileKey className="w-5 h-5 mr-2 text-emerald-400" />
                            {t("settings.licenseSettings")}
                        </CardTitle>
                        <CardDescription className="theme-text-secondary">
                            {t("settings.licenseSettingsDesc")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* License Expiration Setting */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium theme-text-secondary">
                                {t("settings.licenseExpiration")}
                            </label>
                            <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="unlimited"
                                        name="expiration"
                                        checked={licenseExpirationType === "unlimited"}
                                        onChange={() => setLicenseExpirationType("unlimited")}
                                        className="w-4 h-4 text-emerald-500 border-emerald-500/20 focus:ring-emerald-500/20"
                                    />
                                    <label htmlFor="unlimited" className="text-sm theme-text-secondary">
                                        {t("settings.unlimited")}
                                    </label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="custom"
                                        name="expiration"
                                        checked={licenseExpirationType === "custom"}
                                        onChange={() => setLicenseExpirationType("custom")}
                                        className="w-4 h-4 text-emerald-500 border-emerald-500/20 focus:ring-emerald-500/20"
                                    />
                                    <label htmlFor="custom" className="text-sm theme-text-secondary">
                                        {t("settings.customDays")}
                                    </label>
                                </div>
                            </div>
                            {licenseExpirationType === "custom" && (
                                <div className="flex items-center space-x-2 mt-2">
                                    <Input
                                        type="number"
                                        min="1"
                                        max="3650"
                                        value={customExpirationDays}
                                        onChange={(e) => setCustomExpirationDays(Number(e.target.value))}
                                        className="w-24 theme-input text-sm"
                                        placeholder="365"
                                    />
                                    <span className="text-sm theme-text-secondary">{t("settings.days")}</span>
                                </div>
                            )}
                            <p className="text-xs theme-text-muted">{t("settings.licenseExpirationDesc")}</p>
                        </div>

                        {/* Master Key Display */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium theme-text-secondary">{t("settings.masterKey")}</label>
                            <div className="flex items-center space-x-2">
                                <Input
                                    type="text"
                                    value={masterKey}
                                    readOnly
                                    tabIndex={-1}
                                    className="flex-1 theme-input text-sm font-mono select-none pointer-events-none"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyToClipboard(masterKey)}
                                    className="h-10 w-10 p-0 theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
                                >
                                    <Copy className="w-4 h-4" />
                                </Button>
                            </div>
                            <p className="text-xs theme-text-muted">{t("settings.masterKeyDesc")}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Display Settings Card */}
                <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="theme-text-primary flex items-center">
                            <Settings className="w-5 h-5 mr-2 text-emerald-400" />
                            {t("settings.displaySettings")}
                        </CardTitle>
                        <CardDescription className="theme-text-secondary">
                            {t("settings.displaySettingsDesc")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        {/* Items per page setting */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium theme-text-secondary">{t("settings.itemsPerPage")}</label>
                            <Select value={itemsPerPage.toString()} onValueChange={(value) => setItemsPerPage(Number(value))}>
                                <SelectTrigger className="theme-card-bg border-emerald-500/20 theme-text-primary max-w-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="theme-card-bg border-emerald-500/20">
                                    <SelectItem value="10">10 items</SelectItem>
                                    <SelectItem value="25">25 items</SelectItem>
                                    <SelectItem value="50">50 items</SelectItem>
                                    <SelectItem value="100">100 items</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs theme-text-muted">{t("settings.itemsPerPageDesc")}</p>
                        </div>

                        {/* Theme setting */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium theme-text-secondary">{t("settings.theme")}</label>
                            <div className="flex items-center space-x-3">
                                <ThemeToggle />
                                <span className="text-sm theme-text-secondary">
                                  {theme === "dark"
                                      ? t("settings.darkMode")
                                      : theme === "light"
                                          ? t("settings.lightMode")
                                          : t("settings.lightMode") // fallback
                                  }
                                </span>
                            </div>
                            <p className="text-xs theme-text-muted">{t("settings.themeDesc")}</p>
                        </div>

                        {/* Language setting */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium theme-text-secondary">{t("settings.language")}</label>
                            <LanguageToggle />
                            <p className="text-xs theme-text-muted">{t("settings.languageDesc")}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Save button */}
                <div className="flex justify-center pt-4">
                    <Button onClick={() => alert("dashbord")}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-8"
                    >
                        {t("actions.save")}
                    </Button>
                </div>
            </div>

            {/* Plan Change Dialog */}
            <Dialog open={planChangeDialog} onOpenChange={setPlanChangeDialog}>
                <DialogContent className="theme-card-bg border-emerald-500/20 theme-text-primary max-w-4xl max-h-[100vh] overflow-y-auto">
                    <DialogHeader className="sticky top-0 pb-4 border-b border-emerald-500/20">
                        <DialogTitle className="flex items-center">
                            <Key className="w-5 h-5 mr-2 text-emerald-400" />
                            {t("settings.changePlan")}
                        </DialogTitle>
                        <DialogDescription className="theme-text-secondary">{t("settings.choosePlan")}</DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 py-4 md:py-6 px-1">
                        {planInfo?.available && Object.entries(planInfo.available).map(([tier, limits]) => (
                            <div
                                key={tier}
                                className={`p-4 md:p-6 rounded-lg border-2 transition-all cursor-pointer ${
                                    selectedPlan === tier
                                        ? "border-emerald-500 bg-emerald-500/10"
                                        : currentTier === tier
                                            ? "border-emerald-500/50 bg-emerald-500/5"
                                            : "border-emerald-500/20 hover:border-emerald-500/40"
                                }`}
                                onClick={() => setSelectedPlan(tier as PlanTier)}
                            >
                                <div className="text-center space-y-3 md:space-y-4">
                                    <div
                                        className={`inline-flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-lg ${
                                            tier === "free" ? "bg-gray-500/20" :
                                                tier === "basic" ? "bg-blue-500/20" :
                                                    "bg-purple-500/20"
                                        }`}
                                    >
                                        {tier === "free" && <Shield className="w-5 h-5 md:w-6 md:h-6 text-gray-400" />}
                                        {tier === "basic" && <Key className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />}
                                        {tier === "pro" && <FileKey className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />}
                                    </div>

                                    <div>
                                        <h3 className="text-lg md:text-xl font-bold theme-text-primary">
                                            {formatPlanName(tier)}
                                        </h3>
                                        <div className="text-sm theme-text-secondary mt-2">
                                            {formatPlanLimits(limits)}
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-xs md:text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="theme-text-secondary">Rate Limit:</span>
                                            <span className="theme-text-primary font-medium">
                                                {limits.rateLimit}/sec
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="theme-text-secondary">Burst Limit:</span>
                                            <span className="theme-text-primary font-medium">
                                                {limits.burstLimit}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="theme-text-secondary">Quota:</span>
                                            <span className="theme-text-primary font-medium">
                                                {limits.quotaLimit.toLocaleString()}/{limits.quotaPeriod.toLowerCase()}
                                            </span>
                                        </div>
                                    </div>

                                    {currentTier === tier && (
                                        <Badge className="bg-emerald-500 text-white text-xs">{t("settings.currentPlan")}</Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <DialogFooter className="pt-4 border-t border-emerald-500/20 flex-col sm:flex-row gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setPlanChangeDialog(false)
                                setSelectedPlan(null)
                            }}
                            className="border-emerald-500/40 theme-text-secondary hover:bg-emerald-500/20 w-full sm:w-auto"
                            disabled={isChangingPlan}
                        >
                            {t("actions.cancel")}
                        </Button>
                        <Button
                            onClick={handlePlanChange}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white w-full sm:w-auto"
                            disabled={!selectedPlan || selectedPlan === currentTier || isChangingPlan}
                        >
                            {isChangingPlan ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Changing...
                                </>
                            ) : (
                                t("settings.updatePlan")
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    )
}