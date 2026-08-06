/** Africa/Cairo calendar-month bounds for quota metering (013-saas-layer). */

export const CAIRO_TZ = 'Africa/Cairo';

/** Returns the Cairo-local {year, month} (1-indexed) for a given UTC instant. */
function cairoYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/** Offset (in minutes) such that Cairo local time = UTC + offset, evaluated near `date`. */
function cairoOffsetMinutesNear(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Intl renders midnight as "24:00" for hour12:false in some environments; normalize.
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asIfUtc - date.getTime()) / 60_000);
}

/** UTC instant corresponding to 00:00:00 Cairo-local on the 1st of `year`-`month` (1-indexed). */
function cairoMonthStartUtc(year: number, month: number): Date {
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const offsetMinutes = cairoOffsetMinutesNear(naiveUtcGuess);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60_000);
}

/**
 * Africa/Cairo calendar-month bounds for the given instant (defaults to now).
 * `from` = start of the Cairo month (inclusive), `to` = start of the next Cairo month (exclusive).
 */
export function cairoMonthBounds(now: Date = new Date()): {
  from: Date;
  to: Date;
  monthKey: string;
} {
  const { year, month } = cairoYearMonth(now);
  const from = cairoMonthStartUtc(year, month);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = cairoMonthStartUtc(nextYear, nextMonth);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  return { from, to, monthKey };
}

/** `YYYY-MM-DD` strings for the Cairo month, for callers that need date-only bounds (e.g. AnalyticsService). */
export function cairoMonthDateStrings(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
  monthKey: string;
} {
  const { monthKey } = cairoMonthBounds(now);
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    monthKey,
  };
}
