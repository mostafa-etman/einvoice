export const DUE_SOON_DAYS = 7;

export type ManualBillingStatus =
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'UNPAID'
  | 'DUE_SOON'
  | 'OVERDUE';

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addUtcDays(value: Date, days: number): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Manual ledger status. Never charges anything — derived from amount due,
 * sum of recorded payments, and the operator-set due date.
 */
export function deriveManualBillingStatus(input: {
  amountDueEgp: number;
  amountPaidEgp: number;
  dueDate: Date | null;
  now?: Date;
}): ManualBillingStatus {
  const outstanding = input.amountDueEgp - input.amountPaidEgp;
  if (outstanding <= 0) return 'PAID';

  const now = input.now ?? new Date();
  const today = startOfUtcDay(now);
  if (input.dueDate) {
    const due = startOfUtcDay(input.dueDate);
    if (due < today) return 'OVERDUE';
    if (due <= addUtcDays(today, DUE_SOON_DAYS)) return 'DUE_SOON';
  }
  if (input.amountPaidEgp > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}
