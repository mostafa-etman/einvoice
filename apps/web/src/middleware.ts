import createMiddleware from 'next-intl/middleware';
import { defaultLocale, localePrefix, locales } from './i18n/config';

export default createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix,
  // Accept-Language → /en or /ar; unmatched / missing header → /ar
  localeDetection: true,
});

export const config = {
  matcher: [
    // Bare domain: https://eta.erp-esafe.com/ → /ar (or /en from Accept-Language)
    '/',
    // Prefixed routes: /ar/..., /en/...
    '/(ar|en)/:path*',
    // Unprefixed paths like /login → /ar/login
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
