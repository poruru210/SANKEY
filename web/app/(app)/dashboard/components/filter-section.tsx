"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Search, Filter, X, Key, Hash } from "lucide-react"
import {useI18n} from "@/lib/i18n-context";


interface FilterSectionProps {
    accountFilter: string
    setAccountFilter: (value: string) => void
    xAccountFilter: string
    setXAccountFilter: (value: string) => void
    brokerFilter: string
    setBrokerFilter: (value: string) => void
    eaNameFilter: string
    setEaNameFilter: (value: string) => void
    allBrokers: string[]
    clearFilters: () => void
    hasActiveFilters: boolean
    isMobile: boolean
    showAdvancedFilters: boolean
    setShowAdvancedFilters: (value: boolean) => void
    filteredPendingCount: number
    filteredActiveCount: number
}

export function FilterSection({
                                  accountFilter,
                                  setAccountFilter,
                                  xAccountFilter,
                                  setXAccountFilter,
                                  brokerFilter,
                                  setBrokerFilter,
                                  eaNameFilter,
                                  setEaNameFilter,
                                  allBrokers,
                                  clearFilters,
                                  hasActiveFilters,
                                  isMobile,
                                  showAdvancedFilters,
                                  setShowAdvancedFilters,
                                  filteredPendingCount,
                                  filteredActiveCount,
                              }: FilterSectionProps) {
    const { t } = useI18n()

    return (
        <Card className="theme-card-bg border-emerald-500/20 backdrop-blur-sm mb-6">
            <CardHeader className="pb-3">
                <CardTitle className="theme-text-primary flex items-center">
                    <Filter className="w-5 h-5 mr-2 text-emerald-400" />
                    {t("filters.title")}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-5"}`}>
                        {/* Account Number Filter */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium theme-text-secondary">{t("filters.accountNumber")}</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-emerald-400" />
                                <input
                                    type="text"
                                    placeholder={t("filters.searchAccount")}
                                    value={accountFilter}
                                    onChange={(e) => setAccountFilter(e.target.value)}
                                    className="w-full pl-10 pr-3 py-2 theme-input rounded-md focus:outline-none focus:border-emerald-400 text-sm"
                                />
                            </div>
                        </div>

                        {/* Mobile Advanced Filters Button */}
                        {isMobile && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium theme-text-secondary opacity-0">Advanced</label>
                                <Button
                                    variant="outline"
                                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                    className="w-full bg-emerald-500/20 border-emerald-400/40 theme-text-primary hover:bg-emerald-500/30 hover:border-emerald-300 focus:theme-text-primary focus:bg-emerald-500/30"
                                >
                                    <Filter className="w-4 h-4 mr-2" />
                                    {showAdvancedFilters ? t("filters.hideAdvanced") : t("filters.advancedSearch")}
                                </Button>
                            </div>
                        )}

                        {/* Advanced Filters */}
                        {(!isMobile || showAdvancedFilters) && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium theme-text-secondary">{t("filters.eaName")}</label>
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-emerald-400" />
                                        <input
                                            type="text"
                                            placeholder={t("filters.searchEaName")}
                                            value={eaNameFilter}
                                            onChange={(e) => setEaNameFilter(e.target.value)}
                                            className="w-full pl-10 pr-3 py-2 theme-input rounded-md focus:outline-none focus:border-emerald-400 text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium theme-text-secondary">{t("filters.broker")}</label>
                                    <select
                                        value={brokerFilter}
                                        onChange={(e) => setBrokerFilter(e.target.value)}
                                        className="w-full px-3 py-2 theme-input theme-select rounded-md focus:outline-none focus:border-emerald-400 text-sm"
                                    >
                                        <option value="">{t("filters.allBrokers")}</option>
                                        {allBrokers.map((broker) => (
                                            <option key={broker} value={broker}>
                                                {broker}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium theme-text-secondary">{t("filters.xAccount")}</label>
                                    <div className="relative">
                                        <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-emerald-400" />
                                        <input
                                            type="text"
                                            placeholder={t("filters.searchXAccount")}
                                            value={xAccountFilter}
                                            onChange={(e) => setXAccountFilter(e.target.value)}
                                            className="w-full pl-10 pr-3 py-2 theme-input rounded-md focus:outline-none focus:border-emerald-400 text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium theme-text-secondary opacity-0">Clear</label>
                                    <Button
                                        variant="outline"
                                        onClick={clearFilters}
                                        disabled={!hasActiveFilters}
                                        className={`w-full filter-clear-button`}
                                    >
                                        <X className="w-4 h-4 mr-2" />
                                        {t("filters.clearFilters")}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}