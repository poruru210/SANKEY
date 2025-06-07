import './globals.css'

export const metadata = {
    title: 'SANKEY - EA License Management System',
    description: 'Enterprise Application License Management System',
}

export default function RootLayout({
                                       children,
                                   }: {
    children: React.ReactNode
}) {
    return (
        <html suppressHydrationWarning>
        <body>
        {children}
        </body>
        </html>
    )
}