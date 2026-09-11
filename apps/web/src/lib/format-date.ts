function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayLocale(locale: string): string {
  return locale.startsWith('ar') ? 'ar-EG' : 'en-GB';
}

/** DISPLAY ONLY. Locale-aware calendar date (Arabic-Indic digits in `ar`). */
export function formatDateDisplay(
  value: Date | string | number | null | undefined,
  locale: string,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(displayLocale(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** DISPLAY ONLY. Locale-aware date + time. */
export function formatDateTimeDisplay(
  value: Date | string | number | null | undefined,
  locale: string,
): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(displayLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Latin digits, ISO calendar date (`YYYY-MM-DD`).
 * Use for values a user may paste into ETA portals or signed payloads.
 */
export function formatEtaDate(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Latin digits date-time. Never Arabic-Indic — safe to copy into ETA tools.
 */
export function formatEtaDateTime(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Cairo',
  }).format(date);
}
