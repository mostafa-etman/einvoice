/** Cairo calendar dates — same timezone as Usage Analytics. */

export function cairoTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function monthToDateRange(todayIso: string): { from: string; to: string } {
  const [year, month] = todayIso.split('-');
  return { from: `${year}-${month}-01`, to: todayIso };
}

function shiftCalendarMonth(iso: string, deltaMonths: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = Math.min(day, lastDay);
  const y = first.getUTCFullYear();
  const m = String(first.getUTCMonth() + 1).padStart(2, '0');
  const d = String(clamped).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function previousMonthToDate(current: { from: string; to: string }): {
  from: string;
  to: string;
} {
  return {
    from: shiftCalendarMonth(current.from, -1),
    to: shiftCalendarMonth(current.to, -1),
  };
}

export function monthOverMonthRatio(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export function deltaDirection(
  ratio: number,
): 'up' | 'down' | 'flat' {
  if (ratio > 0.0005) return 'up';
  if (ratio < -0.0005) return 'down';
  return 'flat';
}
