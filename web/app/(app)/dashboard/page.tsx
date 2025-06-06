"use client"

import {useState} from "react"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs"
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
import {Shield, Clock, CheckCircle, History, X, AlertTriangle, RefreshCw} from "lucide-react"

// Import dashboard components
import {StatsCards} from "./components/stats-cards"
import {FilterSection} from "./components/filter-section"
import {PendingApplications} from "./components/pending-applications"
import {ActiveLicenses} from "./components/active-licenses"
import {LicenseHistories} from "./components/license-histories"
import {useI18n} from "@/lib/i18n-context"
import {useDashboard} from "@/hooks/use-dashboard"

export default function DashboardPage() {
    const {t} = useI18n()

    const {data, state, actions} = useDashboard()

    const handleApprove = async (applicationId: string) => {
        try {
            await actions.approveApplication(applicationId)
        } catch (error) {
            console.error('Failed to approve application:', error)
        }
    }

    const handleCancel = async (applicationId: string, eaName: string) => {
        try {
            await actions.cancelApplication(applicationId)
        } catch (error) {
            console.error('Failed to cancel application:', error)
        }
    }

    const handleReject = async (applicationId: string, eaName: string) => {
        try {
            await actions.rejectApplication(applicationId)
        } catch (error) {
            console.error('Failed to reject application:', error)
        }
    }

    const handleDeactivate = async (licenseId: string, eaName: string) => {
        try {
            await actions.deactivateApplication(licenseId)
        } catch (error) {
            console.error('Failed to deactivate license:', error)
        }
    }

    const handleLoadTimeline = async (applicationId: string) => {
        try {
            await actions.loadApplicationTimeline(applicationId)
        } catch (error) {
            console.error('Failed to load application timeline:', error)
        }
    }

    if (state.loading && data.pending.length === 0 && data.active.length === 0) {
        return (
            <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                    <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                            <div
                                className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500 mx-auto"></div>
                            <p className="mt-4 theme-text-secondary">{t("common.loadingApplications")}</p>
                        </div>
                    </div>
                </main>
            </div>
        )
    }

    if (state.error) {
        return (
            <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                    <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4"/>
                            <h3 className="text-lg font-semibold theme-text-primary mb-2">{t("common.failedToLoad")}</h3>
                            <p className="theme-text-secondary mb-4">{state.error}</p>
                            <div className="space-x-2">
                                <button
                                    onClick={actions.loadApplications}
                                    disabled={state.loading}
                                    className="px-4 py-2 bg-[var(--btn-approve-bg)] text-[var(--btn-approve-text)] rounded hover:bg-[var(--btn-approve-hover-bg)] transition-colors disabled:opacity-50"
                                >
                                    {state.loading ? t("common.loading") : t("common.retry")}
                                </button>
                                <button
                                    onClick={actions.clearError}
                                    className="px-4 py-2 bg-[var(--btn-dismiss-bg)] text-[var(--btn-dismiss-text)] rounded hover:bg-[var(--btn-dismiss-hover-bg)] transition-colors"
                                >
                                    {t("common.dismiss")}
                                </button>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        )
    }

    return (
        <div>
            <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 container mx-auto px-4 py-8 pb-12 relative z-10">
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center space-x-3">
                                <Shield className="w-8 h-8 text-emerald-400"/>
                                <div>
                                    <h2 className="text-3xl font-bold theme-text-primary">{t("dashboard.title")}</h2>
                                    <p className="theme-text-secondary">{t("dashboard.subtitle")}</p>
                                </div>
                            </div>
                            <button
                                onClick={actions.loadApplications}
                                disabled={state.loading}
                                className="flex items-center space-x-2 px-3 py-2 text-sm bg-[var(--btn-refresh-bg)] text-[var(--btn-refresh-text)] border border-[var(--btn-refresh-border)] rounded hover:bg-[var(--btn-refresh-hover-bg)] transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${state.loading ? 'animate-spin' : ''}`}/>
                                <span>
                                    {state.loading
                                        ? t("common.loading")
                                        : state.error
                                            ? t("common.retry")
                                            : t("common.refresh")
                                    }
                                </span>
                            </button>
                        </div>
                    </div>

                    <StatsCards
                        pendingCount={data.stats.pendingCount}
                        activeCount={data.stats.activeCount}
                        totalIssued={data.stats.totalIssued}
                        expiringSoon={data.stats.expiringSoon}
                    />

                    <FilterSection
                        accountFilter={state.filters.accountNumber}
                        setAccountFilter={(value) => actions.updateFilter('accountNumber', value)}
                        xAccountFilter={state.filters.xAccount}
                        setXAccountFilter={(value) => actions.updateFilter('xAccount', value)}
                        brokerFilter={state.filters.broker}
                        setBrokerFilter={(value) => actions.updateFilter('broker', value)}
                        eaNameFilter={state.filters.eaName}
                        setEaNameFilter={(value) => actions.updateFilter('eaName', value)}
                        allBrokers={data.brokers}
                        clearFilters={actions.clearFilters}
                        hasActiveFilters={state.hasActiveFilters}
                        isMobile={state.isMobile}
                        showAdvancedFilters={state.showAdvancedFilters}
                        setShowAdvancedFilters={actions.setShowAdvancedFilters}
                        filteredPendingCount={data.pending.length}
                        filteredActiveCount={data.active.length}
                    />

                    <Tabs defaultValue="pending" className="w-full">
                        <TabsList
                            className="grid w-full grid-cols-3 theme-card-bg border border-emerald-500/20 p-1 rounded-lg overflow-hidden">
                            <TabsTrigger
                                value="pending"
                                className="data-[state=active]:bg-[var(--tab-active-bg)] data-[state=active]:text-[var(--tab-active-text)] data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 text-[var(--tab-inactive-text)] hover:text-[var(--tab-inactive-hover-text)] hover:bg-[var(--tab-inactive-hover-bg)] transition-all duration-200 text-xs sm:text-sm rounded-l-md rounded-r-none m-0"
                            >
                                <Clock className="w-4 h-4 mr-1 sm:mr-2"/>
                                <span className="hidden sm:inline">{t("tabs.pending")}</span>
                                <span className="sm:hidden">{t("tabs.pendingShort")}</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="approved"
                                className="data-[state=active]:bg-[var(--tab-active-bg)] data-[state=active]:text-[var(--tab-active-text)] data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 text-[var(--tab-inactive-text)] hover:text-[var(--tab-inactive-hover-text)] hover:bg-[var(--tab-inactive-hover-bg)] transition-all duration-200 text-xs sm:text-sm rounded-none m-0"
                            >
                                <CheckCircle className="w-4 h-4 mr-1 sm:mr-2"/>
                                <span className="hidden sm:inline">{t("tabs.active")}</span>
                                <span className="sm:hidden">{t("tabs.activeShort")}</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="history"
                                className="data-[state=active]:bg-[var(--tab-active-bg)] data-[state=active]:text-[var(--tab-active-text)] data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25 text-[var(--tab-inactive-text)] hover:text-[var(--tab-inactive-hover-text)] hover:bg-[var(--tab-inactive-hover-bg)] transition-all duration-200 text-xs sm:text-sm rounded-r-md rounded-l-none m-0"
                            >
                                <History className="w-4 h-4 mr-1 sm:mr-2"/>
                                <span className="hidden sm:inline">{t("tabs.history")}</span>
                                <span className="sm:hidden">{t("tabs.historyShort")}</span>
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="pending" className="mt-6">
                            <PendingApplications
                                applications={data.pending}
                                onApprove={handleApprove}
                                onReject={handleReject}
                                onCancel={handleCancel}
                                currentPage={state.pendingPagination.currentPage}
                                totalPages={state.pendingPagination.totalPages}
                                onPageChange={actions.updatePendingPage}
                                totalItems={state.pendingPagination.totalItems}
                                itemsPerPage={state.pendingPagination.itemsPerPage}
                            />
                        </TabsContent>

                        <TabsContent value="approved" className="mt-6">
                            <ActiveLicenses
                                licenses={data.active}
                                onDeactivate={handleDeactivate}
                                currentPage={state.activePagination.currentPage}
                                totalPages={state.activePagination.totalPages}
                                onPageChange={actions.updateActivePage}
                                totalItems={state.activePagination.totalItems}
                                itemsPerPage={state.activePagination.itemsPerPage}
                                timeline={data.selectedApplicationTimeline}
                                timelineLoading={state.timelineLoading}
                                timelineError={state.timelineError}
                                onLoadTimeline={handleLoadTimeline}
                            />
                        </TabsContent>

                        <TabsContent value="history" className="mt-6">
                            <LicenseHistories
                                histories={data.history}
                                currentPage={state.historyPagination.currentPage}
                                totalPages={state.historyPagination.totalPages}
                                onPageChange={actions.updateHistoryPage}
                                totalItems={state.historyPagination.totalItems}
                                itemsPerPage={state.historyPagination.itemsPerPage}
                                timeline={data.selectedApplicationTimeline}
                                timelineLoading={state.timelineLoading}
                                timelineError={state.timelineError}
                                onLoadTimeline={handleLoadTimeline}
                            />
                        </TabsContent>
                    </Tabs>
                </main>
            </div>
        </div>
    )
}