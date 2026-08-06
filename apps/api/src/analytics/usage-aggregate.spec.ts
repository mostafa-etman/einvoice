import {
  aggregateEventsToTotals,
  emptyTotals,
  type UsageEventLike,
} from './usage-aggregate';

describe('usage-aggregate accuracy (T013/T018 pure)', () => {
  it('sums counter meters and takes latest storage_bytes gauge', () => {
    const t0 = new Date('2026-08-01T08:00:00.000Z');
    const t1 = new Date('2026-08-01T12:00:00.000Z');
    const events: UsageEventLike[] = [
      { meter: 'issued', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'issued', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'received', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'valid', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'invalid', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'api_calls', quantity: 5, occurredAt: t0 },
      { meter: 'storage_bytes', quantity: 1000, occurredAt: t0 },
      { meter: 'storage_bytes', quantity: 1500, occurredAt: t1 },
    ];

    const totals = aggregateEventsToTotals(events);
    expect(totals).toEqual({
      issued: 2,
      received: 1,
      valid: 1,
      invalid: 1,
      api_calls: 5,
      storage_bytes: 1500,
    });
  });

  it('all-branches sums branch dims; branch filter scopes document meters only', () => {
    const t0 = new Date('2026-08-01T08:00:00.000Z');
    const events: UsageEventLike[] = [
      { meter: 'issued', quantity: 1, occurredAt: t0, branchId: 'b1', currencyCode: 'EGP' },
      { meter: 'issued', quantity: 1, occurredAt: t0, branchId: 'b2', currencyCode: 'EGP' },
      { meter: 'api_calls', quantity: 3, occurredAt: t0 },
    ];

    expect(aggregateEventsToTotals(events).issued).toBe(2);
    expect(aggregateEventsToTotals(events, { branchId: 'b1' }).issued).toBe(1);
    expect(aggregateEventsToTotals(events, { branchId: 'b1' }).api_calls).toBe(3);
  });

  it('emptyTotals starts at zero', () => {
    expect(emptyTotals().issued).toBe(0);
    expect(emptyTotals().storage_bytes).toBe(0);
  });
});
