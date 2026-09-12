/**
 * Local export date bounds. Date-only values (and the UTC-midnight ISO the
 * date &lt;input&gt; used to emit) are interpreted as Africa/Cairo calendar days
 * so Egypt-issued documents are not dropped from the selected range.
 */

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/;

/** Egypt observes permanent UTC+2 (no DST) — same as report filters. */
const CAIRO_OFFSET = '+02:00';

export type LocalExportIssueRange = {
  gte?: Date;
  lte?: Date;
};

export function cairoDayStart(dateYmd: string): Date {
  return new Date(`${dateYmd}T00:00:00.000${CAIRO_OFFSET}`);
}

export function cairoDayEnd(dateYmd: string): Date {
  return new Date(`${dateYmd}T23:59:59.999${CAIRO_OFFSET}`);
}

export function parseLocalExportInstant(
  value: string | undefined,
  role: 'from' | 'to',
): Date | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    return role === 'from' ? cairoDayStart(dateOnly[1]!) : cairoDayEnd(dateOnly[1]!);
  }
  const utcMidnight = UTC_MIDNIGHT.exec(raw);
  if (utcMidnight && role === 'from') {
    return cairoDayStart(utcMidnight[1]!);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

export function localExportIssueRange(
  from?: string,
  to?: string,
): LocalExportIssueRange | undefined {
  const gte = parseLocalExportInstant(from, 'from');
  const lte = parseLocalExportInstant(to, 'to');
  if (!gte && !lte) return undefined;
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}
