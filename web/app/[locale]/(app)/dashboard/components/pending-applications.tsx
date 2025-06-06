"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Clock, Mail, Hash, X } from "lucide-react"
import { PaginationControls } from "./pagination-controls"
import { ConfirmationDialog } from "./confirmation-dialog"
import { useTranslations } from "next-intl"
import { PendingApplicationUI } from "@/types/ea-application"
import { getStatusTranslationKey, getStatusStyle } from "../utils/status-utils"

interface PendingApplicationsProps {
    applications: PendingApplicationUI[]
    onApprove: (id: string) => void
    onReject: (id: string, eaName: string) => void
    onCancel?: (applicationId: string, eaName: string) => void
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
    totalItems: number
    itemsPerPage: number
}

// カウントダウンフック
const useCountdown = (targetDate: string) => {
    const [timeLeft, setTimeLeft] = useState('')

    useEffect(() => {
        if (!targetDate) return

        const timer = setInterval(() => {
            const now = new Date().getTime()
            const target = new Date(targetDate).getTime()
            const difference = target - now

            if (difference > 0) {
                const minutes = Math.floor(difference / (1000 * 60))
                const seconds = Math.floor((difference % (1000 * 60)) / 1000)

                if (difference < 30000) { // 30秒未満
                    setTimeLeft('まもなく送信')
                } else {
                    setTimeLeft(`${minutes}分${seconds}秒後送信`)
                }
            } else {
                setTimeLeft('送信完了')
            }
        }, 1000)

        return () => clearInterval(timer)
    }, [targetDate])

    return timeLeft
}

export function PendingApplications({
                                        applications,
                                        onApprove,
                                        onReject,
                                        onCancel,
                                        currentPage,
                                        totalPages,
                                        onPageChange,
                                        totalItems,
                                        itemsPerPage,
                                    }: PendingApplicationsProps) {
    const t = useTranslations()

    // 確認ダイアログの状態管理
    const [dialogState, setDialogState] = useState<{
        open: boolean
        type: 'approve' | 'reject' | 'cancel' | null
        targetId: string
        targetName: string
        scheduledAt?: string
    }>({
        open: false,
        type: null,
        targetId: '',
        targetName: '',
        scheduledAt: undefined
    })

    // ダイアログ用のカウントダウンフック
    const dialogCountdown = useCountdown(dialogState.scheduledAt || '')

    // ローディング状態の管理
    const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({})

    const formatDate = (dateString: string) => {
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

    const renderStatusBadge = (status: string) => {
        const statusKey = getStatusTranslationKey(status)
        const statusStyle = getStatusStyle(status)

        return (
            <Badge
                // variant="outline" // Removed to allow background variables to take full effect
                className={`${statusStyle} px-2.5 py-0.5 text-xs font-semibold`} // Added base badge styling here
            >
                {t(statusKey)}
            </Badge>
        )
    }

    // 承認ボタンクリック時の処理
    const handleApproveClick = (id: string, eaName: string) => {
        setDialogState({
            open: true,
            type: 'approve',
            targetId: id,
            targetName: eaName,
            scheduledAt: undefined
        })
    }

    // 却下ボタンクリック時の処理
    const handleRejectClick = (id: string, eaName: string) => {
        setDialogState({
            open: true,
            type: 'reject',
            targetId: id,
            targetName: eaName,
            scheduledAt: undefined
        })
    }

    // キャンセルボタンクリック時の処理
    const handleCancelClick = (id: string, eaName: string, scheduledAt?: string) => {
        setDialogState({
            open: true,
            type: 'cancel',
            targetId: id,
            targetName: eaName,
            scheduledAt: scheduledAt
        })
    }

    // 確認ダイアログでのアクション実行
    const handleConfirmAction = async () => {
        const { type, targetId, targetName } = dialogState

        // ローディング状態を設定
        setLoadingStates(prev => ({ ...prev, [targetId]: true }))

        try {
            switch (type) {
                case 'approve':
                    await onApprove(targetId)
                    break
                case 'reject':
                    await onReject(targetId, targetName)
                    break
                case 'cancel':
                    if (onCancel) {
                        await onCancel(targetId, targetName)
                    }
                    break
            }
        } catch (error) {
            console.error(`${type} action failed:`, error)
        } finally {
            // ローディング状態を解除
            setLoadingStates(prev => ({ ...prev, [targetId]: false }))
            // ダイアログを閉じる
            setDialogState({
                open: false,
                type: null,
                targetId: '',
                targetName: '',
                scheduledAt: undefined
            })
        }
    }

    // ダイアログを閉じる処理
    const handleDialogClose = () => {
        setDialogState({
            open: false,
            type: null,
            targetId: '',
            targetName: '',
            scheduledAt: undefined
        })
    }

    // ダイアログの設定を取得
    const getDialogConfig = () => {
        switch (dialogState.type) {
            case 'approve':
                return {
                    title: t("dialog.approveTitle"),
                    description: t("dialog.approveDescription")
                }
            case 'reject':
                return {
                    title: t("dialog.rejectTitle"),
                    description: t("dialog.rejectMessage")
                }
            case 'cancel':
                return {
                    title: t("dialog.stopSendingTitle"),
                    description: t("dialog.stopSendingDescription")
                }
            default:
                return {
                    title: '',
                    description: ''
                }
        }
    }

    const renderActionButtons = (app: PendingApplicationUI) => {
        const isLoading = loadingStates[app.id]

        if (app.status === 'AwaitingNotification') {
            return (
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Button
                        size="sm"
                        variant="outline" // Keep variant outline for this specific button, or define new vars if needed
                        onClick={() => handleCancelClick(app.id, app.eaName, app.notificationScheduledAt)}
                        disabled={isLoading}
                        className="border bg-[var(--btn-reject-bg)] text-[var(--btn-reject-text)] border-[var(--btn-reject-border)] hover:bg-[var(--btn-reject-hover-bg)]" // Used reject vars
                    >
                        {isLoading ? (
                            <>
                                <div className="w-4 h-4 mr-1 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                {t("common.processing")}
                            </>
                        ) : (
                            <>
                                <X className="w-4 h-4 mr-1" />
                                {t("actions.stopSending")}
                            </>
                        )}
                    </Button>
                </div>
            )
        }

        return (
            <div className="flex space-x-2">
                <Button
                    size="sm"
                    onClick={() => handleApproveClick(app.id, app.eaName)}
                    disabled={isLoading}
                    className="bg-[var(--btn-approve-bg)] text-[var(--btn-approve-text)] hover:bg-[var(--btn-approve-hover-bg)] focus:text-[var(--btn-approve-text)] focus:bg-[var(--btn-approve-hover-bg)] flex-1 sm:flex-none"
                >
                    {isLoading && dialogState.type === 'approve' && dialogState.targetId === app.id ? (
                        <>
                            <div className="w-4 h-4 mr-1 border-2 border-[var(--btn-approve-text)] border-t-transparent rounded-full animate-spin" />
                            {t("common.processing")}
                        </>
                    ) : (
                        <>
                            <CheckCircle className="w-4 h-4 mr-1" />
                            {t("actions.approve")}
                        </>
                    )}
                </Button>
                <Button
                    size="sm"
                    variant="outline" // Keep variant outline for this button type
                    onClick={() => handleRejectClick(app.id, app.eaName)}
                    disabled={isLoading}
                    className="border bg-[var(--btn-reject-bg)] text-[var(--btn-reject-text)] border-[var(--btn-reject-border)] hover:bg-[var(--btn-reject-hover-bg)] flex-1 sm:flex-none"
                >
                    {isLoading && dialogState.type === 'reject' && dialogState.targetId === app.id ? (
                        <>
                            <div className="w-4 h-4 mr-1 border-2 border-[var(--btn-reject-text)] border-t-transparent rounded-full animate-spin" />
                            {t("common.processing")}
                        </>
                    ) : (
                        <>
                            <X className="w-4 h-4 mr-1" />
                            {t("actions.reject")}
                        </>
                    )}
                </Button>
            </div>
        )
    }

    const dialogConfig = getDialogConfig()

    return (
        <>
            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="theme-text-primary flex items-center">
                        <Clock className="w-5 h-5 mr-2 text-yellow-400" />
                        {t("tabs.pending")}
                    </CardTitle>
                    <CardDescription className="theme-text-secondary">
                        {t("tabs.pendingDescription")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {applications.map((app) => (
                            <div
                                key={app.id}
                                className="p-4 theme-card-bg rounded-lg border border-emerald-500/10 hover:border-emerald-500/20 transition-colors"
                            >
                                <div className="flex flex-col space-y-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                                    <div className="flex items-center space-x-3">
                                        <h3 className="font-semibold theme-text-primary">{app.eaName}</h3>
                                        {renderStatusBadge(app.status)}
                                    </div>
                                    {renderActionButtons(app)}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                    <div>
                                        <span className="theme-text-emerald">{t("fields.account")}:</span>{" "}
                                        <span className="theme-text-primary">{app.accountNumber}</span>
                                    </div>
                                    <div>
                                        <span className="theme-text-emerald">{t("fields.broker")}:</span>{" "}
                                        <span className="theme-text-primary">{app.broker}</span>
                                    </div>
                                    <div className="flex items-center">
                                        <Mail className="w-3 h-3 mr-1 text-emerald-400" />
                                        <span className="theme-text-primary">{app.email}</span>
                                    </div>
                                    <div className="flex items-center">
                                        <Hash className="w-3 h-3 mr-1 text-emerald-400" />
                                        <span className="theme-text-primary">{app.xAccount}</span>
                                    </div>
                                    <div>
                                        <span className="theme-text-emerald">{t("fields.applied")}:</span>{" "}
                                        <span className="theme-text-primary">{formatDate(app.appliedAt)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {applications.length === 0 && (
                        <div className="text-center py-8 theme-text-secondary">
                            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>{t("tabs.noPendingApplications")}</p>
                        </div>
                    )}

                    <PaginationControls
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={onPageChange}
                        totalItems={totalItems}
                        itemType="applications"
                        itemsPerPage={itemsPerPage}
                    />
                </CardContent>
            </Card>

            {/* 確認ダイアログ */}
            <ConfirmationDialog
                open={dialogState.open}
                onOpenChange={handleDialogClose}
                title={dialogConfig.title}
                description={dialogConfig.description}
                actionType={dialogState.type || 'cancel'}
                onConfirm={handleConfirmAction}
                loading={loadingStates[dialogState.targetId]}
                targetName={dialogState.targetName}
                countdown={dialogState.type === 'cancel' && dialogState.scheduledAt ? dialogCountdown : undefined}
            />
        </>
    )
}