/**
 * Shared UI number display helpers.
 * Thin wrappers around @einvoice/eta-core display formatters.
 *
 * DISPLAY ONLY — never use for form field values that are submitted to the API/ETA,
 * or anywhere that feeds signed canonical content. Keep raw numeric strings in inputs.
 */

export {
  formatMoneyDisplay,
  formatQuantityDisplay,
} from '@einvoice/eta-core';

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * DISPLAY ONLY. Western digits + ASCII `%`.
 * `value` is a ratio (`0.124` → `12.4%`).
 */
export function formatPercent(value: unknown, fractionDigits = 1): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

/**
 * DISPLAY ONLY. Western digits, compact notation (`1284` → `1.3K`).
 * Latin digits even for `ar` so figures stay paste-safe and match money display.
 */
export function formatCompact(value: unknown): string {
  const n = toFiniteNumber(value);
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
