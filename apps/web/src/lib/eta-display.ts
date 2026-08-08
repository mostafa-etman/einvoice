/** Locale-aware display helpers for ETA codes shown to Egyptian users. */

export type UiLocale = 'en' | 'ar';

export type CatalogName = {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
};

/** B / P / F → human label for the active UI language. */
export function partyTypeLabel(
  code: string | null | undefined,
  locale: UiLocale,
): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (locale === 'ar') {
    if (c === 'B') return 'شركة';
    if (c === 'P') return 'شخص';
    if (c === 'F') return 'أجنبي';
  } else {
    if (c === 'B') return 'Company';
    if (c === 'P') return 'Person';
    if (c === 'F') return 'Foreign';
  }
  return c || '—';
}

/** Prefer Arabic catalog name when locale is ar. */
export function catalogDisplayName(
  entry: CatalogName | null | undefined,
  locale: UiLocale,
): string {
  if (!entry) return '';
  const en = (entry.nameEn ?? '').trim();
  const ar = (entry.nameAr ?? '').trim();
  if (locale === 'ar') return ar || en || entry.code;
  return en || ar || entry.code;
}

export function catalogOptionLabel(
  entry: CatalogName,
  locale: UiLocale,
): string {
  const name = catalogDisplayName(entry, locale);
  return name && name !== entry.code ? `${entry.code} — ${name}` : entry.code;
}
