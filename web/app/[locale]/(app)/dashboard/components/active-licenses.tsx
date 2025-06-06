"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, ShieldAlert, Mail, Hash, KeyRound, Calendar, History } from "lucide-react"
import { PaginationControls } from "./pagination-controls"
import { ConfirmationDialog } from "./confirmation-dialog"
import { LicenseDisplayModal } from "./license-display-modal"
import { ApplicationTimelineDrawer } from "./application-timeline-drawer"
import { useTranslations } from "next-intl"
import { ActiveLicenseUI, EAApplicationHistory } from "@/types/ea-application"
import { getStatusTranslationKey, getStatusStyle } from "../utils/status-utils"
import { useApplicationLicense } from "@/hooks/use-license"

interface ActiveLicensesProps {
    licenses: ActiveLicenseUI[]
    onDeactivate: (id: string, eaName: string) => void
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

export function ActiveLicenses({
                                   licenses,
                                   onDeactivate,
                                   currentPage,
                                   totalPages,
                                   onPageChange,
                                   totalItems,
                                   itemsPerPage,
                                   timeline,
                                   timelineLoading,
                                   timelineError,
                                   onLoadTimeline,
                               }: ActiveLicensesProps) {
    const t = useTranslations()

    const {
        decryptedLicense,
        isDecrypting,
        decryptError,
        decryptLicense,
        resetDecrypt
    } = useApplicationLicense()

    const [dialogState, setDialogState] = useState<{
        open: boolean
        targetId: string
        targetName: string
    }>({
        open: false,
        targetId: '',
        targetName: '',
    })

    const [modalState, setModalState] = useState<{
        open: boolean
        applicationId: string
        eaName: string
        licenseData: string | null
        loading: boolean
    }>({
        open: false,
        applicationId: '',
        eaName: '',
        licenseData: null,
        loading: false
    })

    const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({})

    const handleShowLicense = async (applicationId: string, eaName: string) => {
        setModalState({
            open: true,
            applicationId,
            eaName,
            licenseData: null,
            loading: true
        })

        resetDecrypt()

        try {
            const result = await decryptLicense(applicationId)

            if (result) {
                setModalState(prev => ({
                    ...prev,
                    licenseData: result.decryptedKey,
                    loading: false
                }))
            } else {
                setModalState(prev => ({
                    ...prev,
                    loading: false
                }))
            }
        } catch (error) {
            console.error('Failed to decrypt license:', error)
            setModalState(prev => ({
                ...prev,
                loading: false
            }))
        }
    }

    const handleCloseModal = () => {
        setModalState({
            open: false,
            applicationId: '',
            eaName: '',
            licenseData: null,
            loading: false
        })
        resetDecrypt()
    }

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

    const isExpiringSoon = (expiryDate: string) => {
        if (!expiryDate) return false
        const expiry = new Date(expiryDate)
        const now = new Date()
        const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return daysUntilExpiry <= 30
    }

    const renderStatusBadge = (status: string) => {
        const statusKey = getStatusTranslationKey(status)
        const statusStyle = getStatusStyle(status)

        return (
            <Badge
                className={`${statusStyle} px-2.5 py-0.5 text-xs font-semibold`}
            >
                {t(statusKey)}
            </Badge>
        )
    }

    const handleDeactivateClick = (id: string, eaName: string) => {
        setDialogState({
            open: true,
            targetId: id,
            targetName: eaName,
        })
    }

    const handleConfirmDeactivate = async () => {
        const { targetId, targetName } = dialogState

        setLoadingStates(prev => ({ ...prev, [targetId]: true }))

        try {
            await onDeactivate(targetId, targetName)
        } catch (error) {
            console.error('Deactivate action failed:', error)
        } finally {
            setLoadingStates(prev => ({ ...prev, [targetId]: false }))
            setDialogState({
                open: false,
                targetId: '',
                targetName: '',
            })
        }
    }

    const handleDialogClose = () => {
        setDialogState({
            open: false,
            targetId: '',
            targetName: '',
        })
    }

    return (
        <>
            <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="theme-text-primary flex items-center">
                        <CheckCircle className="w-5 h-5 mr-2 text-emerald-400" />
                        {t("tabs.active")}
                    </CardTitle>
                    <CardDescription className="theme-text-secondary">
                        {t("tabs.activeDescription")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {licenses.map((license) => {
                            const isLoading = loadingStates[license.id]
                            const expiringSoon = isExpiringSoon(license.expiryDate)
                            const isDecryptingThis = isDecrypting && modalState.applicationId === license.id

                            return (
                                <div
                                    key={license.id}
                                    className="p-4 theme-card-bg rounded-lg border border-emerald-500/10 hover:border-emerald-500/20 transition-colors"
                                >
                                    <div className="flex flex-col space-y-3 mb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                                        <div className="flex items-center space-x-1">
                                            <h3 className="font-semibold theme-text-primary">{license.eaName}</h3>
                                            {renderStatusBadge(license.status)}
                                            {expiringSoon && (
                                                <Badge variant="outline" className="border-yellow-500 text-yellow-400">
                                                    <ShieldAlert className="w-3 h-3 mr-1" />
                                                    {t("status.expiringSoon")}
                                                </Badge>
                                            )}
                                            <ApplicationTimelineDrawer
                                                applicationId={license.id}
                                                applicationName={license.eaName}
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
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleShowLicense(license.id, license.eaName)}
                                                disabled={isDecryptingThis}
                                                className="h-6 w-6 p-0 theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
                                            >
                                                {isDecryptingThis ? (
                                                    <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                                                ) : (
                                                    <KeyRound className="w-4 h-4" />
                                                )}
                                            </Button>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleDeactivateClick(license.id, license.eaName)}
                                            disabled={isLoading}
                                            className="border bg-[var(--btn-deactivate-bg)] text-[var(--btn-deactivate-text)] border-[var(--btn-deactivate-border)] hover:bg-[var(--btn-deactivate-hover-bg)]"
                                        >
                                            {isLoading ? (
                                                <>
                                                    <div className="w-4 h-4 mr-1 border-2 border-[var(--btn-deactivate-text)] border-t-transparent rounded-full animate-spin" />
                                                    {t("common.processing")}
                                                </>
                                            ) : (
                                                <>
                                                    <ShieldAlert className="w-4 h-4 mr-1" />
                                                    {t("actions.deactivate")}
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm theme-text-muted mb-3">
                                        <div>
                                            <span className="theme-text-emerald">{t("fields.account")}:</span>{" "}
                                            <span className="theme-text-primary">{license.accountNumber}</span>
                                        </div>
                                        <div>
                                            <span className="theme-text-emerald">{t("fields.broker")}:</span>{" "}
                                            <span className="theme-text-primary">{license.broker}</span>
                                        </div>
                                        <div className="flex items-center">
                                            <Mail className="w-3 h-3 mr-1 text-emerald-400" />
                                            <span className="theme-text-primary">{license.email}</span>
                                        </div>
                                        <div className="flex items-center">
                                            <Hash className="w-3 h-3 mr-1 text-emerald-400" />
                                            <span className="theme-text-primary">{license.xAccount}</span>
                                        </div>
                                        <div className={`flex items-center ${expiringSoon ? 'text-yellow-400' : ''}`}>
                                            <span className="theme-text-emerald">{t("fields.expires")}:</span>{" "}
                                            <span className="theme-text-primary">{formatDate(license.expiryDate)}</span>
                                        </div>
                                        <div className="flex items-center">
                                            <Calendar className="w-3 h-3 mr-1 text-emerald-400" />
                                            <span className="theme-text-emerald">Last updated:</span>{" "}
                                            <span className="theme-text-primary">{formatDate(license.activatedAt)}</span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {licenses.length === 0 && (
                        <div className="text-center py-8 theme-text-secondary">
                            <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>{t("tabs.noActiveLicenses")}</p>
                        </div>
                    )}

                    <PaginationControls
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={onPageChange}
                        totalItems={totalItems}
                        itemType="licenses"
                        itemsPerPage={itemsPerPage}
                    />
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={dialogState.open}
                onOpenChange={handleDialogClose}
                title={t("dialog.deactivateTitle")}
                description={t("dialog.deactivateDescription")}
                actionType="deactivate"
                onConfirm={handleConfirmDeactivate}
                loading={loadingStates[dialogState.targetId]}
                targetName={dialogState.targetName}
            />

            <LicenseDisplayModal
                open={modalState.open}
                onOpenChange={handleCloseModal}
                licenseData={modalState.licenseData}
                loading={modalState.loading}
                eaName={modalState.eaName}
            />
        </>
    )
}