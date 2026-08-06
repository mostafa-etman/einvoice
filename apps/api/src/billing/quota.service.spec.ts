import { cairoMonthBounds, cairoMonthDateStrings } from './quota-period';
import { mergeEntitlements } from './quota.service';

describe('cairoMonthBounds', () => {
  it('computes Africa/Cairo calendar-month start/end for a mid-month UTC instant', () => {
    const { from, to, monthKey } = cairoMonthBounds(new Date('2026-03-15T10:00:00.000Z'));
    expect(monthKey).toBe('2026-03');
    // Cairo is fixed UTC+2 in this environment's tzdata — local midnight Mar 1 = Feb 28 22:00 UTC.
    expect(from.toISOString()).toBe('2026-02-28T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });

  it('rolls over to the next Cairo month near a UTC month boundary', () => {
    // 2026-01-31T23:30Z is already 01:30 on Feb 1 in Cairo (UTC+2).
    const { monthKey, from } = cairoMonthBounds(new Date('2026-01-31T23:30:00.000Z'));
    expect(monthKey).toBe('2026-02');
    expect(from.toISOString()).toBe('2026-01-31T22:00:00.000Z');
  });

  it('handles the December → January year rollover', () => {
    const { to, monthKey } = cairoMonthBounds(new Date('2026-12-10T00:00:00.000Z'));
    expect(monthKey).toBe('2026-12');
    expect(to.getUTCFullYear()).toBe(2026);
    expect(to.toISOString()).toBe('2026-12-31T22:00:00.000Z');
  });

  it('to (next month start) is always after from (this month start)', () => {
    const { from, to } = cairoMonthBounds(new Date());
    expect(to.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('cairoMonthDateStrings', () => {
  it('returns YYYY-MM-DD bounds matching the Cairo month', () => {
    const { fromDate, toDate, monthKey } = cairoMonthDateStrings(
      new Date('2026-02-10T00:00:00.000Z'),
    );
    expect(monthKey).toBe('2026-02');
    expect(fromDate).toBe('2026-02-01');
    expect(toDate).toBe('2026-02-28');
  });

  it('handles a 31-day month', () => {
    const { fromDate, toDate } = cairoMonthDateStrings(new Date('2026-03-10T00:00:00.000Z'));
    expect(fromDate).toBe('2026-03-01');
    expect(toDate).toBe('2026-03-31');
  });
});

describe('mergeEntitlements', () => {
  const plan = {
    code: 'FREE' as const,
    documentQuota: 100,
    branchQuota: 1,
    deviceQuota: 1,
  };

  it('uses plan quotas when there is no override', () => {
    const result = mergeEntitlements(plan, null);
    expect(result).toEqual({
      planCode: 'FREE',
      documentQuota: 100,
      branchQuota: 1,
      deviceQuota: 1,
      overrideActive: false,
    });
  });

  it('applies an active, never-expiring override field-by-field', () => {
    const result = mergeEntitlements(plan, {
      documentQuota: 500,
      branchQuota: null,
      deviceQuota: null,
      expiresAt: null,
    });
    expect(result.documentQuota).toBe(500);
    expect(result.branchQuota).toBe(1);
    expect(result.deviceQuota).toBe(1);
    expect(result.overrideActive).toBe(true);
  });

  it('ignores an expired override and falls back to plan quotas', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const result = mergeEntitlements(
      plan,
      {
        documentQuota: 999,
        branchQuota: 99,
        deviceQuota: 99,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      },
      now,
    );
    expect(result.documentQuota).toBe(100);
    expect(result.overrideActive).toBe(false);
  });

  it('treats an override active exactly at the boundary as expired', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const result = mergeEntitlements(
      plan,
      { documentQuota: 500, branchQuota: null, deviceQuota: null, expiresAt: now },
      now,
    );
    expect(result.overrideActive).toBe(false);
    expect(result.documentQuota).toBe(100);
  });
});
