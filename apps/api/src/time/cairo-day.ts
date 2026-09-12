/**
 * Egypt observes permanent UTC+2 (no DST). Date-only values and the UTC-midnight
 * / UTC-end-of-day ISO strings the date &lt;input&gt; used to emit are treated as
 * Africa/Cairo calendar days so invoices around midnight are not dropped.
 */

export const CAIRO_OFFSET = '+02:00';

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/;
const UTC_END_OF_DAY = /^(\d{4}-\d{2}-\d{2})T23:59:59(\.\d+)?Z$/;

export function cairoDayStart(dateYmd: string): Date {
  return new Date(`${dateYmd}T00:00:00.000${CAIRO_OFFSET}`);
}

export function cairoDayEnd(dateYmd: string): Date {
  return new Date(`${dateYmd}T23:59:59.999${CAIRO_OFFSET}`);
}

export function parseCairoBoundedInstant(
  value: string | Date | null | undefined,
  role: 'from' | 'to',
): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (!value || typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    return role === 'from'
      ? cairoDayStart(dateOnly[1]!)
      : cairoDayEnd(dateOnly[1]!);
  }
  const utcMidnight = UTC_MIDNIGHT.exec(raw);
  if (utcMidnight && role === 'from') {
    return cairoDayStart(utcMidnight[1]!);
  }
  const utcEnd = UTC_END_OF_DAY.exec(raw);
  if (utcEnd && role === 'to') {
    return cairoDayEnd(utcEnd[1]!);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}
