/**
 * ETA dateTimeIssued pattern: yyyy-MM-ddTHH:mm:ssZ (UTC, no milliseconds).
 * Example from SDK: 2015-02-13T13:15:00Z
 */
export const ETA_DATETIME_ISSUED_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Normalize any Date / ISO string to ETA dateTimeIssued format (no ms).
 */
export function formatEtaDateTimeIssued(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid dateTimeIssued: ${String(input)}`);
  }
  // toISOString → 2026-07-31T09:16:00.000Z → strip fractional seconds
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isValidEtaDateTimeIssued(value: unknown): value is string {
  return typeof value === 'string' && ETA_DATETIME_ISSUED_PATTERN.test(value);
}

/**
 * ETA Decimal fields must be JSON numbers (not strings) — schema NumberExpected.
 * Keep calculation in decimal strings; convert only when writing the ETA payload.
 */
export function toEtaDecimalNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ETA decimal: ${String(value)}`);
  }
  return n;
}
