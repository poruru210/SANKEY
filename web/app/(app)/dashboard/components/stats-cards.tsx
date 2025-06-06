"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock, CheckCircle, Key, FileKey } from "lucide-react"
import {useI18n} from "@/lib/i18n-context";

interface StatsCardsProps {
    pendingCount: number
    activeCount: number
    totalIssued: number
    expiringSoon: number
}

export function StatsCards({ pendingCount, activeCount, totalIssued, expiringSoon }: StatsCardsProps) {
    const { t } = useI18n()

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium theme-text-primary flex items-center">
                        <Clock className="w-4 h-4 mr-2 text-yellow-400" />
                        {t("dashboard.pendingApplications")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold theme-text-primary">{pendingCount}</div>
                    <p className="text-xs theme-text-muted">{t("dashboard.awaitingApproval")}</p>
                </CardContent>
            </Card>

            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium theme-text-primary flex items-center">
                        <CheckCircle className="w-4 h-4 mr-2 text-emerald-400" />
                        {t("dashboard.activeApplications")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold theme-text-primary">{activeCount}</div>
                    <p className="text-xs theme-text-muted">{t("dashboard.currentlyActive")}</p>
                </CardContent>
            </Card>

            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium theme-text-primary flex items-center">
                        <Key className="w-4 h-4 mr-2 text-emerald-400" />
                        {t("dashboard.totalIssued")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold theme-text-primary">{totalIssued}</div>
                    <p className="text-xs theme-text-muted">{t("dashboard.allTimeIssued")}</p>
                </CardContent>
            </Card>

            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium theme-text-primary flex items-center">
                        <FileKey className="w-4 h-4 mr-2 text-amber-400" />
                        {t("dashboard.expiringSoon")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold theme-text-primary">{expiringSoon}</div>
                    <p className="text-xs theme-text-muted">{t("dashboard.within30Days")}</p>
                </CardContent>
            </Card>
        </div>
    )
}