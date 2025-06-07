"use client"

import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Copy, Eye, X } from "lucide-react"
import { useTranslations } from "next-intl"

interface LicenseDisplayModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    licenseData: string | null
    loading: boolean
    eaName: string
}

export function LicenseDisplayModal({
                                        open,
                                        onOpenChange,
                                        licenseData,
                                        loading,
                                        eaName,
                                    }: LicenseDisplayModalProps) {
    const t = useTranslations()

    const handleClose = () => {
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] theme-dialog-bg border-emerald-500/20">
                <DialogHeader>
                    <DialogTitle className="theme-text-primary flex items-center">
                        <Eye className="w-5 h-5 mr-2 text-emerald-400" />
                        {t("dialog.licenseInfo")} - {eaName}
                    </DialogTitle>
                    <DialogDescription className="theme-text-secondary">
                        {t("dialog.licenseInfoDescription")}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {loading && (
                        <div className="text-center py-8">
                            <div className="w-8 h-8 mx-auto border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
                            <p className="theme-text-secondary">{t("dialog.decrypting")}</p>
                        </div>
                    )}

                    {!loading && licenseData && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold theme-text-primary">{t("dialog.decryptedLicense")}</h3>
                            </div>

                            <div className="relative">
                                <pre className="theme-dialog-content-bg p-4 rounded-lg border border-emerald-500/20 text-sm theme-text-primary font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                                    {licenseData}
                                </pre>
                            </div>

                            <div className="text-xs theme-text-secondary">
                                ⚠️ {t("dialog.licenseWarning")}
                            </div>
                        </div>
                    )}

                    {!loading && !licenseData && (
                        <div className="text-center py-8 theme-text-secondary">
                            <p>{t("dialog.decryptionFailed")}</p>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-4 border-t border-emerald-500/20">
                    <Button
                        onClick={handleClose}
                        variant="outline"
                        className="theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20"
                    >
                        <X className="w-4 h-4 mr-1" />
                        {t("actions.close")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}