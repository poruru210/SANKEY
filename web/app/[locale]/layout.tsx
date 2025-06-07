import React from "react"
import { Inter } from "next/font/google"
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { ThemeProvider } from '@/components/theme-provider'
import { SessionProvider } from 'next-auth/react'
import SessionErrorHandler from '@/app/components/SessionErrorHandler'
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

interface LocaleLayoutProps {
    children: React.ReactNode;
    params: Promise<{
        locale: string;
    }>;
}

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
                                               children,
                                               params
                                           }: LocaleLayoutProps) {
    // Next.js 15: paramsがPromiseなのでawaitする
    const { locale } = await params;

    // ロケールが無効な場合のフォールバック
    const validLocale = routing.locales.includes(locale as any) ? locale : routing.defaultLocale;


    try {
        // メッセージを取得
        const messages = await getMessages({ locale: validLocale });

        return (
            <div lang={validLocale} className={inter.className}>
                <NextIntlClientProvider locale={validLocale} messages={messages}>
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
                </NextIntlClientProvider>
            </div>
        )
    } catch (error) {
        console.error('🔍 LocaleLayout error:', error);
        // エラー時のフォールバック
        return (
            <div lang="en" className={inter.className}>
                <div>Loading...</div>
            </div>
        )
    }
}