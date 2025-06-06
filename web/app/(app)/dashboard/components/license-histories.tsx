"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {CheckCircle, X, Mail, Hash, History, Clock, AlertTriangle} from "lucide-react"
import { PaginationControls } from "./pagination-controls"
import { ApplicationTimelineDrawer } from "./application-timeline-drawer"
import { useI18n } from "@/lib/i18n-context"
import { LicenseHistoryUI, EAApplicationHistory } from "@/types/ea-application"
import { getStatusTranslationKey, getStatusStyle } from "../utils/status-utils"

interface LicenseHistoryProps {
    histories: LicenseHistoryUI[]
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
    totalItems: number
    itemsPerPage: number
    timeline: EAApplicationHistory[]
    timelineLoading: boolean
    timelineError: string | null
    onLoadTimeline: (applicationId: string) => Promise<void>
}

export function LicenseHistories({
                                     histories,
                                     currentPage,
                                     totalPages,
                                     onPageChange,
                                     totalItems,
                                     itemsPerPage,
                                     timeline,
                                     timelineLoading,
                                     timelineError,
                                     onLoadTimeline,
                                 }: LicenseHistoryProps) {
    const { t } = useI18n()

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A'
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
        } catch {
            return dateString
        }
    }

    const getStatusInfo = (status: string) => {
        const statusStyle = getStatusStyle(status)

        return {
            className: statusStyle
        }
    }

    const getActionDate = (history: LicenseHistoryUI) => {
        return history.lastUpdatedAt || history.issuedAt
    }

    return (
        <>
            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="theme-text-primary flex items-center">
                        <History className="w-5 h-5 mr-2 text-emerald-400" />
                        {t("tabs.history")}
                    </CardTitle>
                    <CardDescription className="theme-text-secondary">
                        {t("tabs.historyDescription")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {histories.map((history) => {
                            const statusInfo = getStatusInfo(history.status)
                            const actionDate = getActionDate(history)

                            return (
                                <div
                                    key={history.id}
                                    className="p-4 theme-card-bg rounded-lg border border-emerald-500/10 hover:border-emerald-500/20 transition-colors"
                                >
                                    <div className="flex flex-col space-y-3 mb-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                                        <div className="flex items-center space-x-1">
                                            <h3 className="font-semibold theme-text-primary">{history.eaName}</h3>
                                            <Badge
                                                variant="outline"
                                                className={statusInfo.className}
                                            >
                                                {t(getStatusTranslationKey(history.status))}
                                            </Badge>
                                            <ApplicationTimelineDrawer
                                                applicationId={history.id}
                                                applicationName={history.eaName}
                                                timeline={timeline}
                                                isLoading={timelineLoading}
                                                error={timelineError}
                                                onLoadTimeline={onLoadTimeline}
                                            >
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="p-1 h-auto hover:bg-emerald-500/10"
                                                    title="変更履歴を表示"
                                                >
                                                    <History className="w-4 h-4 text-emerald-400" />
                                                </Button>
                                            </ApplicationTimelineDrawer>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm theme-text-muted mb-3">
                                        <div>
                                            <span className="theme-text-emerald">{t("fields.account")}:</span>{" "}
                                            <span className="theme-text-primary">{history.accountNumber}</span>
                                        </div>
                                        <div>
                                            <span className="theme-text-emerald">{t("fields.broker")}:</span>{" "}
                                            <span className="theme-text-primary">{history.broker}</span>
                                        </div>
                                        <div className="flex items-center">
                                            <Mail className="w-3 h-3 mr-1 text-emerald-400" />
                                            <span className="theme-text-primary">{history.email}</span>
                                        </div>
                                        <div className="flex items-center">
                                            <Hash className="w-3 h-3 mr-1 text-emerald-400" />
                                            <span className="theme-text-primary">{history.xAccount}</span>
                                        </div>
                                        <div>
                                            <span className="theme-text-emerald">Last updated:</span>{" "}
                                            <span className="theme-text-primary">{formatDate(actionDate)}</span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {histories.length === 0 && (
                        <div className="text-center py-8 theme-text-secondary">
                            <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>{t("tabs.noLicenseHistory")}</p>
                        </div>
                    )}

                    <PaginationControls
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={onPageChange}
                        totalItems={totalItems}
                        itemType="historyRecords"
                        itemsPerPage={itemsPerPage}
                    />
                </CardContent>
            </Card>
        </>
    )
}