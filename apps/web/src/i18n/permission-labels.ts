import { defaultLocale, locales, type AppLocale } from './config';
import ar from './permission-labels.ar.json';
import en from './permission-labels.en.json';

const byLocale: Record<AppLocale, Record<string, string>> = { ar, en };

export function getPermissionLabels(locale: string): Record<string, string> {
  const resolved = locales.includes(locale as AppLocale)
    ? (locale as AppLocale)
    : defaultLocale;
  return byLocale[resolved];
}
