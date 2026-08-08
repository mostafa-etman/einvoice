import Decimal from 'decimal.js';

/** Configure Decimal for money: enough precision, no exp notation for normal amounts. */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number | Decimal;

function d(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/**
 * Format as money with exactly 2 fractional digits.
 * Midpoints round half away from zero (Decimal.ROUND_HALF_UP).
 *
 * CRITICAL: This is the canonical/ETA money string (no thousands separators).
 * Use {@link formatMoneyDisplay} only for UI / PDF display — never for payloads.
 */
export function formatMoney(value: DecimalInput): string {
  return d(value).toFixed(2, Decimal.ROUND_HALF_UP);
}

export function add(a: DecimalInput, b: DecimalInput): string {
  return formatMoney(d(a).plus(d(b)));
}

export function sub(a: DecimalInput, b: DecimalInput): string {
  return formatMoney(d(a).minus(d(b)));
}

export function mul(a: DecimalInput, b: DecimalInput): string {
  return formatMoney(d(a).times(d(b)));
}

export function div(a: DecimalInput, b: DecimalInput): string {
  return formatMoney(d(a).div(d(b)));
}

/** Raw decimal string without forcing 2 dp (rates, quantities). */
export function toDecimalString(value: DecimalInput): string {
  return d(value).toFixed();
}

/**
 * DISPLAY-ONLY money formatting: thousands grouping + exactly 2 decimals.
 * Always uses Western digits (0-9) and en-US grouping (1,234,567.89) so amounts
 * stay LTR-readable under Arabic RTL layouts.
 *
 * NEVER use this for ETA payloads, signed canonical content, or any value that
 * is hashed / submitted. Use {@link formatMoney} for those.
 */
export function formatMoneyDisplay(value: unknown): string {
  if (value == null || value === '') return '—';
  let fixed: string;
  try {
    fixed = formatMoney(String(value));
  } catch {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    fixed = formatMoney(n);
  }
  const neg = fixed.startsWith('-');
  const raw = neg ? fixed.slice(1) : fixed;
  const [intPart, frac = '00'] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}.${frac}`;
}

/**
 * DISPLAY-ONLY quantity / rate formatting with thousands grouping.
 * Keeps up to `maxFractionDigits` (default 5) without forcing trailing zeros.
 * Western digits + en-US grouping. Never use for ETA payloads.
 */
export function formatQuantityDisplay(
  value: unknown,
  maxFractionDigits = 5,
): string {
  if (value == null || value === '') return '—';
  let dec: Decimal;
  try {
    dec = d(String(value));
  } catch {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    dec = d(n);
  }
  const neg = dec.isNeg();
  const abs = dec.abs();
  const fixed = abs.toFixed(maxFractionDigits, Decimal.ROUND_HALF_UP);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  const [intPart, frac] = trimmed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac != null && frac !== '' ? `${grouped}.${frac}` : grouped;
  return `${neg ? '-' : ''}${body}`;
}
