import { BadRequestException } from '@nestjs/common';

export type ReportId =
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4';

export const REPORT_IDS: ReportId[] = [
  'S1',
  'S2',
  'S3',
  'S4',
  'P1',
  'P2',
  'P3',
  'C1',
  'C2',
  'C3',
  'C4',
];

export const PDF_REPORT_IDS: ReportId[] = ['S1', 'P1', 'S4', 'P3', 'C1', 'C4'];

export type ReportFilters = {
  from: string;
  to: string;
  branchId?: string;
  currencyCode?: string;
  perCurrency: boolean;
  includeNonFinancialStatuses: boolean;
  showGross: boolean;
  grain: 'day' | 'month';
  perBranch: boolean;
  limit: number;
  documentKinds?: string[];
  /** Filter VAT return lines to one tax type (e.g. T1, T4). */
  taxType?: string;
  rangeStart: Date;
  rangeEnd: Date;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Egypt observes permanent UTC+2 (no DST). */
export function cairoDayBounds(from: string, to: string): { start: Date; end: Date } {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new BadRequestException('from/to must be YYYY-MM-DD');
  }
  if (from > to) {
    throw new BadRequestException('from must be on or before to');
  }
  return {
    start: new Date(`${from}T00:00:00.000+02:00`),
    end: new Date(`${to}T23:59:59.999+02:00`),
  };
}

export function parseReportId(raw: string): ReportId {
  const id = raw.toUpperCase() as ReportId;
  if (!REPORT_IDS.includes(id)) {
    throw new BadRequestException(`Unknown reportId: ${raw}`);
  }
  return id;
}

export function parseReportFilters(query: Record<string, unknown>): ReportFilters {
  const from = String(query.from ?? '');
  const to = String(query.to ?? '');
  const { start, end } = cairoDayBounds(from, to);
  const grain = query.grain === 'month' ? 'month' : 'day';
  const limitRaw = Number(query.limit ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
    : 50;
  const kindsRaw = query.documentKind ?? query.documentKinds;
  let documentKinds: string[] | undefined;
  if (Array.isArray(kindsRaw)) {
    documentKinds = kindsRaw.map(String).filter(Boolean);
  } else if (typeof kindsRaw === 'string' && kindsRaw.trim()) {
    documentKinds = kindsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return {
    from,
    to,
    branchId: query.branchId ? String(query.branchId) : undefined,
    currencyCode: query.currencyCode
      ? String(query.currencyCode).toUpperCase()
      : undefined,
    perCurrency: query.perCurrency === true || query.perCurrency === 'true',
    includeNonFinancialStatuses:
      query.includeNonFinancialStatuses === true ||
      query.includeNonFinancialStatuses === 'true',
    showGross: query.showGross === true || query.showGross === 'true',
    grain,
    perBranch: query.perBranch === true || query.perBranch === 'true',
    limit,
    documentKinds,
    taxType: query.taxType
      ? String(query.taxType).trim().toUpperCase()
      : undefined,
    rangeStart: start,
    rangeEnd: end,
  };
}

export function bucketKey(d: Date, grain: 'day' | 'month'): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return grain === 'month' ? `${ymd.slice(0, 7)}-01` : ymd;
}
