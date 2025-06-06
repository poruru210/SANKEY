import React from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CheckCircle, X, Trash2, AlertTriangle, Clock } from "lucide-react"
import { useTranslations } from "next-intl"

interface ConfirmationDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    actionType: 'approve' | 'reject' | 'deactivate' | 'cancel'
    onConfirm: () => void
    loading?: boolean
    targetName?: string
    countdown?: string
}

export function ConfirmationDialog({
                                       open,
                                       onOpenChange,
                                       title,
                                       description,
                                       actionType,
                                       onConfirm,
                                       loading = false,
                                       targetName,
                                       countdown
                                   }: ConfirmationDialogProps) {
    const t = useTranslations()

    const getActionButton = () => {
        const baseClasses = "inline-flex items-center justify-center"

        switch (actionType) {
            case 'approve':
                return (
                    <AlertDialogAction
                        onClick={onConfirm}
                        disabled={loading}
                        className={`${baseClasses} bg-[var(--btn-approve-bg)] text-[var(--btn-approve-text)] hover:bg-[var(--btn-approve-hover-bg)]`}
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 mr-2 border-2 border-[var(--btn-approve-text)] border-t-transparent rounded-full animate-spin" />
                                {t("common.processing")}
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                {t("actions.approve")}
                            </>
                        )}
                    </AlertDialogAction>
                )

            case 'reject':
                return (
                    <AlertDialogAction
                        onClick={onConfirm}
                        disabled={loading}
                        className={`${baseClasses} bg-[var(--btn-dialog-destructive-bg)] text-[var(--btn-dialog-destructive-text)] hover:bg-[var(--btn-dialog-destructive-hover-bg)]`}
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 mr-2 border-2 border-[var(--btn-dialog-destructive-text)] border-t-transparent rounded-full animate-spin" />
                                {t("common.processing")}
                            </>
                        ) : (
                            <>
                                <X className="w-4 h-4 mr-2" />
                                {t("actions.reject")}
                            </>
                        )}
                    </AlertDialogAction>
                )

            case 'deactivate':
                return (
                    <AlertDialogAction
                        onClick={onConfirm}
                        disabled={loading}
                        className={`${baseClasses} bg-[var(--btn-dialog-warning-bg)] text-[var(--btn-dialog-warning-text)] hover:bg-[var(--btn-dialog-warning-hover-bg)]`}
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 mr-2 border-2 border-[var(--btn-dialog-warning-text)] border-t-transparent rounded-full animate-spin" />
                                {t("common.processing")}
                            </>
                        ) : (
                            <>
                                <Trash2 className="w-4 h-4 mr-2" />
                                {t("actions.deactivate")}
                            </>
                        )}
                    </AlertDialogAction>
                )

            case 'cancel':
                return (
                    <AlertDialogAction
                        onClick={onConfirm}
                        disabled={loading}
                        className={`${baseClasses} bg-[var(--btn-dialog-destructive-bg)] text-[var(--btn-dialog-destructive-text)] hover:bg-[var(--btn-dialog-destructive-hover-bg)]`}
                    >
                        {loading ? (
                            <>
                                <div className="w-4 h-4 mr-2 border-2 border-[var(--btn-dialog-destructive-text)] border-t-transparent rounded-full animate-spin" />
                                {t("common.processing")}
                            </>
                        ) : (
                            <>
                                <X className="w-4 h-4 mr-2" />
                                {t("actions.stopSending")}
                            </>
                        )}
                    </AlertDialogAction>
                )

            default:
                return null
        }
    }

    const getIcon = () => {
        switch (actionType) {
            case 'approve':
                return <CheckCircle className="w-6 h-6 text-emerald-500" />
            case 'reject':
            case 'cancel':
                return <X className="w-6 h-6 text-red-500" />
            case 'deactivate':
                return <AlertTriangle className="w-6 h-6 text-orange-500" />
            default:
                return null
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="theme-dialog-bg border-emerald-500/20">
                <AlertDialogHeader>
                    <AlertDialogTitle className="theme-text-primary flex items-center">
                        {getIcon()}
                        <span className="ml-2">{title}</span>
                    </AlertDialogTitle>
                    <AlertDialogDescription className="theme-text-secondary">
                        {description}
                    </AlertDialogDescription>
                    {targetName && (
                        <div className="mt-2 p-2 theme-dialog-content-bg rounded text-sm">
                            <strong>{t("dialog.target")}:</strong> {targetName}
                        </div>
                    )}
                    {countdown && actionType === 'cancel' && (
                        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                            <div className="flex items-center text-blue-700 dark:text-blue-300">
                                <Clock className="w-4 h-4 mr-2" />
                                <span className="font-medium">{t("dialog.sendingScheduleStatus")}</span>
                            </div>
                            <div className="mt-1 text-sm text-blue-600 dark:text-blue-400">
                                {countdown}
                            </div>
                        </div>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel
                        disabled={loading}
                        className="border bg-transparent text-[var(--btn-secondary-text)] border-[var(--btn-secondary-border)] hover:bg-[var(--btn-secondary-hover-bg)] hover:border-[var(--btn-secondary-hover-border)]"
                    >
                        {t("actions.back")}
                    </AlertDialogCancel>
                    {getActionButton()}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}