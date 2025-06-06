import { useState } from 'react'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    History,
    Clock,
    User,
    ArrowRight,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Ban,
    FileText,
    Loader2
} from "lucide-react"
import { EAApplicationHistory } from '@/types/ea-application'

interface ApplicationTimelineDrawerProps {
    applicationId: string
    applicationName: string
    timeline: EAApplicationHistory[]
    isLoading: boolean
    error: string | null
    onLoadTimeline: (applicationId: string) => Promise<void>
    children: React.ReactNode
}

export function ApplicationTimelineDrawer({
                                              applicationId,
                                              applicationName,
                                              timeline,
                                              isLoading,
                                              error,
                                              onLoadTimeline,
                                              children
                                          }: ApplicationTimelineDrawerProps) {
    const [isOpen, setIsOpen] = useState(false)

    const handleOpenChange = async (open: boolean) => {
        setIsOpen(open)

        if (open) {
            try {
                await onLoadTimeline(applicationId)
            } catch (error) {
                console.error('Failed to load timeline:', error)
            }
        }
    }

    const formatDate = (dateString: string) => {
        try {
            return new Date(dateString).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        } catch {
            return dateString
        }
    }

    const getActionIcon = (action: string) => {
        switch (action.toLowerCase()) {
            case 'approve':
            case 'approved':
                return <CheckCircle className="w-4 h-4 text-green-500" />
            case 'reject':
            case 'rejected':
                return <XCircle className="w-4 h-4 text-red-500" />
            case 'cancel':
            case 'cancelled':
                return <Ban className="w-4 h-4 text-orange-500" />
            case 'revoke':
            case 'revoked':
                return <AlertTriangle className="w-4 h-4 text-red-600" />
            case 'active':
            case 'activated':
                return <CheckCircle className="w-4 h-4 text-blue-500" />
            case 'pending':
                return <Clock className="w-4 h-4 text-yellow-500" />
            default:
                return <FileText className="w-4 h-4 text-gray-500" />
        }
    }

    const getActionColor = (action: string) => {
        switch (action.toLowerCase()) {
            case 'approve':
            case 'approved':
            case 'active':
            case 'activated':
                return 'bg-green-500/10 text-green-700 border-green-500/20'
            case 'reject':
            case 'rejected':
            case 'revoke':
            case 'revoked':
                return 'bg-red-500/10 text-red-700 border-red-500/20'
            case 'cancel':
            case 'cancelled':
                return 'bg-orange-500/10 text-orange-700 border-orange-500/20'
            case 'pending':
                return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20'
            default:
                return 'bg-gray-500/10 text-gray-700 border-gray-500/20'
        }
    }

    return (
        <Sheet open={isOpen} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>
                {children}
            </SheetTrigger>
            <SheetContent
                side="right"
                className="w-full sm:w-[400px] sm:max-w-none"
            >
                <SheetHeader>
                    <SheetTitle className="flex items-center text-left">
                        <History className="w-5 h-5 mr-2 text-emerald-400" />
                        Application Timeline
                    </SheetTitle>
                    <SheetDescription className="text-left">
                        {applicationName}のステータス変更履歴
                    </SheetDescription>
                </SheetHeader>

                <div className="mt-6">
                    {isLoading && (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                            <span className="ml-2 text-sm text-muted-foreground">
                                読み込み中...
                            </span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center justify-center py-8">
                            <AlertTriangle className="w-6 h-6 text-red-500" />
                            <span className="ml-2 text-sm text-red-600">
                                {error}
                            </span>
                        </div>
                    )}

                    {!isLoading && !error && timeline.length === 0 && (
                        <div className="flex items-center justify-center py-8">
                            <History className="w-6 h-6 text-gray-400" />
                            <span className="ml-2 text-sm text-muted-foreground">
                                履歴データがありません
                            </span>
                        </div>
                    )}

                    {!isLoading && !error && timeline.length > 0 && (
                        <ScrollArea className="h-[calc(100vh-200px)]">
                            <div className="space-y-4">
                                {timeline.map((item, index) => (
                                    <div key={item.sk} className="relative">
                                        {/* Timeline line */}
                                        {index < timeline.length - 1 && (
                                            <div className="absolute left-6 top-12 w-px h-full bg-border" />
                                        )}

                                        <div className="flex items-start space-x-4">
                                            {/* Action icon */}
                                            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-card border flex items-center justify-center">
                                                {getActionIcon(item.action)}
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center space-x-2 mb-1">
                                                    <Badge
                                                        variant="outline"
                                                        className={getActionColor(item.action)}
                                                    >
                                                        {item.action}
                                                    </Badge>
                                                    {item.previousStatus && item.newStatus && (
                                                        <div className="flex items-center text-xs text-muted-foreground">
                                                            <span>{item.previousStatus}</span>
                                                            <ArrowRight className="w-3 h-3 mx-1" />
                                                            <span>{item.newStatus}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center text-xs text-muted-foreground mb-2">
                                                    <Clock className="w-3 h-3 mr-1" />
                                                    {formatDate(item.changedAt)}
                                                </div>

                                                {item.changedBy && (
                                                    <div className="flex items-center text-xs text-muted-foreground mb-2">
                                                        <User className="w-3 h-3 mr-1" />
                                                        {item.changedBy}
                                                    </div>
                                                )}

                                                {item.reason && (
                                                    <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                                                        {item.reason}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {index < timeline.length - 1 && (
                                            <Separator className="mt-4" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}