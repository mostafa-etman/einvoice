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
