'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { signOutCompletely } from '@/lib/auth-actions' // パスはプロジェクトに合わせて調整

export default function SessionErrorHandler({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession()

    useEffect(() => {
        if (status === 'authenticated' && session?.error === 'RefreshAccessTokenError') {
            console.error('RefreshAccessTokenError detected, signing out completely.')
            // 既に signOutCompletely が呼ばれているか、何らかのフラグで無限ループを防ぐことを検討しても良い
            signOutCompletely()
        }
    }, [session, status])

    return <>{children}</>
}
