// app/(app)/page.tsx
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function HomePage() {
    const session = await auth()

    if (!session) {
        redirect('/login')
    }

    // 認証済みユーザーはダッシュボードにリダイレクト
    redirect('/dashboard')
}