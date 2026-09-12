import {
  DEFAULT_SYNC_LOOKBACK_DAYS,
  defaultLookbackRange,
  MAX_SYNC_WINDOWS,
  parseSyncDateRange,
} from './sync-range';

describe('sync-range', () => {
  it('defaults lookback to 90 days', () => {
    expect(DEFAULT_SYNC_LOOKBACK_DAYS).toBe(90);
    const r = defaultLookbackRange(30);
    expect(r.to.getTime() - r.from.getTime()).toBeCloseTo(
      30 * 24 * 60 * 60 * 1000,
      -2,
    );
  });

  it('accepts explicit from/to as Africa/Cairo calendar days', () => {
    const r = parseSyncDateRange(
      { from: '2026-01-01', to: '2026-02-01' },
      defaultLookbackRange(90),
    );
    expect(r.from.toISOString()).toBe('2025-12-31T22:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-02-01T21:59:59.999Z');
  });

  it('treats UTC-midnight / UTC-end-of-day ISO as Cairo day bounds', () => {
    const r = parseSyncDateRange(
      {
        from: '2026-09-12T00:00:00.000Z',
        to: '2026-09-12T23:59:59.999Z',
      },
      defaultLookbackRange(90),
    );
    expect(r.from.toISOString()).toBe('2026-09-11T22:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-12T21:59:59.999Z');
  });

  it('includes Cairo midnight and 23:59 instants for a selected day', () => {
    const r = parseSyncDateRange(
      { from: '2026-09-12', to: '2026-09-12' },
      defaultLookbackRange(90),
    );
    const nearMidnight = new Date('2026-09-11T22:00:00.000Z');
    const nearEnd = new Date('2026-09-12T21:59:59.000Z');
    expect(nearMidnight.getTime()).toBeGreaterThanOrEqual(r.from.getTime());
    expect(nearMidnight.getTime()).toBeLessThanOrEqual(r.to.getTime());
    expect(nearEnd.getTime()).toBeGreaterThanOrEqual(r.from.getTime());
    expect(nearEnd.getTime()).toBeLessThanOrEqual(r.to.getTime());
  });

  it('rejects oversized ranges', () => {
    expect(() =>
      parseSyncDateRange(
        { from: '2020-01-01', to: '2026-01-01' },
        defaultLookbackRange(90),
      ),
    ).toThrow(/too large/i);
  });

  it('caps windows budget', () => {
    expect(MAX_SYNC_WINDOWS).toBeLessThanOrEqual(12);
  });
});
