import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip middleware for static files, API routes, and Next.js internals
    if (
        request.method === 'OPTIONS' ||
        pathname.startsWith('/api') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/_vercel') ||
        pathname === '/favicon.ico' ||
        pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff|woff2|ttf|eot)$/)
    ) {
        return NextResponse.next();
    }

    // Apply internationalization middleware first
    const intlResponse = intlMiddleware(request);

    // Extract locale from pathname for auth checks
    const segments = pathname.split('/').filter(Boolean);
    const locale = segments[0];
    const pathWithoutLocale = segments.length > 1 ? '/' + segments.slice(1).join('/') : '/';

    // Check if this is an auth route (login, etc.)
    const isAuthRoute = pathWithoutLocale === '/login' || pathWithoutLocale.startsWith('/login');
    const isPublicRoute = ['/', '/about', '/contact', '/terms', '/privacy'].includes(pathWithoutLocale);

    if (isAuthRoute || isPublicRoute) {
        return intlResponse;
    }

    // Check authentication for protected routes
    const session = await auth();

    if (!session) {
        const validLocale = routing.locales.includes(locale as any) ? locale : routing.defaultLocale;
        const loginUrl = new URL(`/${validLocale}/login`, request.url);

        // Save current locale in cookie before redirect
        const response = NextResponse.redirect(loginUrl);
        response.cookies.set('preferred-locale', validLocale, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        // Use relative path for returnUrl instead of full URL
        const returnUrl = encodeURIComponent(`/${validLocale}${pathWithoutLocale === '/' ? '/dashboard' : pathWithoutLocale}`);
        loginUrl.searchParams.set('returnUrl', returnUrl);

        return response;
    }

    // Check for session errors
    if (session.error === 'RefreshAccessTokenError') {
        const validLocale = routing.locales.includes(locale as any) ? locale : routing.defaultLocale;
        const loginUrl = new URL(`/${validLocale}/login`, request.url);

        const response = NextResponse.redirect(loginUrl);
        response.cookies.set('preferred-locale', validLocale, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7
        });

        return response;
    }

    return intlResponse;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)'
    ]
};