"use client"

import {ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight} from "lucide-react"
import { useTranslations } from "next-intl"

interface PaginationControlsProps {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
    totalItems: number
    itemType: string
    itemsPerPage: number
}

export function PaginationControls({
                                       currentPage,
                                       totalPages,
                                       onPageChange,
                                       totalItems,
                                       itemType,
                                       itemsPerPage
                                   }: PaginationControlsProps) {
    const t = useTranslations()
    const itemsPerPage2 = itemsPerPage // This should be passed as a prop if it varies
    const startItem = (currentPage - 1) * itemsPerPage2 + 1
    const endItem = Math.min(currentPage * itemsPerPage2, totalItems)

    return (
        <div className="flex flex-col items-center gap-4 mt-6 pt-4 border-t border-emerald-500/20">
            <div className="text-sm theme-text-secondary">
                {t("pagination.showing")} {startItem} {t("pagination.to")} {endItem} {t("pagination.of")} {totalItems}{" "}
                {t(`pagination.${itemType}`)}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center space-x-1">
                    <button
                        onClick={() => onPageChange(1)}
                        disabled={currentPage === 1}
                        className="flex items-center justify-center w-8 h-8 theme-text-emerald hover:theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronsLeft className="w-4 h-4"/>
                    </button>

                    <button
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="flex items-center justify-center w-8 h-8 theme-text-emerald hover:theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4"/>
                    </button>

                    <div className="flex items-center space-x-1 mx-2">
                        {Array.from({length: Math.min(7, totalPages)}, (_, i) => {
                            let pageNumber
                            if (totalPages <= 7) {
                                pageNumber = i + 1
                            } else if (currentPage <= 4) {
                                pageNumber = i + 1
                            } else if (currentPage >= totalPages - 3) {
                                pageNumber = totalPages - 6 + i
                            } else {
                                pageNumber = currentPage - 3 + i
                            }

                            return (
                                <button
                                    key={pageNumber}
                                    onClick={() => onPageChange(pageNumber)}
                                    className={`
                    flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all duration-200
                    ${
                                        currentPage === pageNumber
                                            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 scale-110"
                                            : "theme-text-emerald hover:theme-text-primary hover:bg-emerald-500/20 hover:scale-105"
                                    }
                  `}
                                >
                                    {pageNumber}
                                </button>
                            )
                        })}
                    </div>

                    <button
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="flex items-center justify-center w-8 h-8 theme-text-emerald hover:theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="w-4 h-4"/>
                    </button>

                    <button
                        onClick={() => onPageChange(totalPages)}
                        disabled={currentPage === totalPages}
                        className="flex items-center justify-center w-8 h-8 theme-text-emerald hover:theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronsRight className="w-4 h-4"/>
                    </button>
                </div>
            )}
        </div>
    )
}