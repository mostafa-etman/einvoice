export const locales = ['en', 'ar'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'ar';
export const localePrefix = 'always' as const;

export function isLocalePrefixedPath(pathname: string): boolean {
  return locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
}

/** Prefix a path with the default locale when it has no locale segment. */
export function withDefaultLocalePrefix(pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (path === '/') return `/${defaultLocale}`;
  if (isLocalePrefixedPath(path)) return path;
  return `/${defaultLocale}${path}`;
}
