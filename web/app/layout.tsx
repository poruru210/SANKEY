import React from "react"
import {Inter} from "next/font/google"
import type {Metadata} from "next"
import "./globals.css"
import {ThemeProvider} from '@/components/theme-provider'
import {I18nProvider} from '@/lib/i18n-context'
import { SessionProvider } from 'next-auth/react'
import SessionErrorHandler from '@/app/components/SessionErrorHandler'
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({subsets: ["latin"]})

export const metadata: Metadata = {
    title: "SANKEY - EA License Management System",
    description: "Enterprise Application License Management System",
}

export default function RootLayout({
                                       children,
                                   }: {
    children: React.ReactNode
}) {
    return (
        <html lang="ja" suppressHydrationWarning>
        <body>
        <I18nProvider>
            <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem={true}
                storageKey="theme"
            >
                <SessionProvider>
                    <SessionErrorHandler>
                        {children}
                    </SessionErrorHandler>
                    <Toaster />
                </SessionProvider>
            </ThemeProvider>
        </I18nProvider>
        </body>
        </html>
    )
}