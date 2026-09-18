import { deriveManualBillingStatus } from './manual-billing-status';

describe('deriveManualBillingStatus', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');

  it('is PAID when nothing is outstanding', () => {
    expect(
      deriveManualBillingStatus({ amountDueEgp: 0, amountPaidEgp: 0, dueDate: null, now }),
    ).toBe('PAID');
    expect(
      deriveManualBillingStatus({
        amountDueEgp: 250,
        amountPaidEgp: 250,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        now,
      }),
    ).toBe('PAID');
  });

  it('is OVERDUE when the due date is before today and a balance remains', () => {
    expect(
      deriveManualBillingStatus({
        amountDueEgp: 400,
        amountPaidEgp: 0,
        dueDate: new Date('2026-09-17T00:00:00.000Z'),
        now,
      }),
    ).toBe('OVERDUE');
  });

  it('is DUE_SOON within seven days', () => {
    expect(
      deriveManualBillingStatus({
        amountDueEgp: 400,
        amountPaidEgp: 0,
        dueDate: new Date('2026-09-20T00:00:00.000Z'),
        now,
      }),
    ).toBe('DUE_SOON');
  });

  it('is PARTIALLY_PAID when some money is in and it is not due soon', () => {
    expect(
      deriveManualBillingStatus({
        amountDueEgp: 400,
        amountPaidEgp: 100,
        dueDate: new Date('2026-10-18T00:00:00.000Z'),
        now,
      }),
    ).toBe('PARTIALLY_PAID');
  });

  it('is UNPAID when nothing is recorded and the due date is far or unset', () => {
    expect(
      deriveManualBillingStatus({ amountDueEgp: 400, amountPaidEgp: 0, dueDate: null, now }),
    ).toBe('UNPAID');
  });
});
