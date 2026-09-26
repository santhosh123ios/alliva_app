import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const handleI18n = createMiddleware(routing);
const publicPaths = ['/login', '/forgot', '/reset'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const localeMatch = pathname.match(/^\/(en|ar)(?=\/|$)/);
  const locale = localeMatch?.[1] ?? routing.defaultLocale;
  const pathWithoutLocale = localeMatch ? pathname.slice(localeMatch[0].length) || '/' : pathname;
  const isPublic = publicPaths.some((path) => pathWithoutLocale === path || pathWithoutLocale.startsWith(`${path}/`));
  const isHome = pathWithoutLocale === '/';
  if (isHome || (!isPublic && !request.cookies.has('alliva_access'))) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return handleI18n(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
