/** Canonical usage meters (011). */
export const USAGE_METERS = [
  'issued',
  'received',
  'valid',
  'invalid',
  'api_calls',
  'storage_bytes',
] as const;

export type UsageMeterCode = (typeof USAGE_METERS)[number];

export const ORG_BRANCH_KEY = '00000000-0000-0000-0000-000000000000';
export const ORG_CURRENCY_KEY = '';

export const DOCUMENT_METERS: ReadonlySet<UsageMeterCode> = new Set([
  'issued',
  'received',
  'valid',
  'invalid',
]);

export type UsageEventLike = {
  meter: UsageMeterCode | string;
  quantity: number | string;
  occurredAt: Date | string;
  branchId?: string | null;
  currencyCode?: string | null;
  documentId?: string | null;
};

export type MeterTotals = Record<UsageMeterCode, number>;

export function emptyTotals(): MeterTotals {
  return {
    issued: 0,
    received: 0,
    valid: 0,
    invalid: 0,
    api_calls: 0,
    storage_bytes: 0,
  };
}

export function toNumber(q: number | string): number {
  const n = typeof q === 'number' ? q : Number(q);
  return Number.isFinite(n) ? n : 0;
}

export function branchKeyOf(branchId?: string | null): string {
  return branchId && branchId.length > 0 ? branchId : ORG_BRANCH_KEY;
}

export function currencyKeyOf(currencyCode?: string | null): string {
  return currencyCode && currencyCode.length > 0 ? currencyCode : ORG_CURRENCY_KEY;
}

/**
 * Aggregate events for a filter window.
 * - Counters: sum(quantity)
 * - storage_bytes: latest absolute gauge by occurredAt
 * - No branchId filter ⇒ sum all branch dimensions for document meters (I2)
 * - valid/invalid: sum remaining events (emitters supersede prior outcome rows)
 */
export function aggregateEventsToTotals(
  events: UsageEventLike[],
  filters?: {
    branchId?: string | null;
    currencyCode?: string | null;
  },
): MeterTotals {
  const totals = emptyTotals();
  const branchFilter = filters?.branchId ?? null;
  const currencyFilter = filters?.currencyCode ?? null;

  const filtered = events.filter((e) => {
    const meter = e.meter as UsageMeterCode;
    if (!USAGE_METERS.includes(meter)) return false;
    if (DOCUMENT_METERS.has(meter)) {
      if (branchFilter && (e.branchId ?? null) !== branchFilter) return false;
      if (currencyFilter && (e.currencyCode ?? null) !== currencyFilter) {
        return false;
      }
    }
    return true;
  });

  const byMeter = new Map<UsageMeterCode, UsageEventLike[]>();
  for (const e of filtered) {
    const meter = e.meter as UsageMeterCode;
    const list = byMeter.get(meter) ?? [];
    list.push(e);
    byMeter.set(meter, list);
  }

  for (const meter of USAGE_METERS) {
    const list = byMeter.get(meter) ?? [];
    if (list.length === 0) {
      totals[meter] = 0;
      continue;
    }
    if (meter === 'storage_bytes') {
      let latest = list[0]!;
      let latestTs = new Date(latest.occurredAt).getTime();
      for (const e of list) {
        const ts = new Date(e.occurredAt).getTime();
        if (ts >= latestTs) {
          latest = e;
          latestTs = ts;
        }
      }
      totals[meter] = toNumber(latest.quantity);
    } else {
      totals[meter] = list.reduce((sum, e) => sum + toNumber(e.quantity), 0);
    }
  }

  return totals;
}

/** Calendar date YYYY-MM-DD in a given IANA timezone (Africa/Cairo default). */
export function bucketDateInTz(
  occurredAt: Date,
  timeZone = 'Africa/Cairo',
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(occurredAt);
}

export function monthStartFromBucketDate(bucketDate: string): string {
  return `${bucketDate.slice(0, 7)}-01`;
}
