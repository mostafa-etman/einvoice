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

  it('accepts explicit from/to', () => {
    const r = parseSyncDateRange(
      { from: '2026-01-01', to: '2026-02-01' },
      defaultLookbackRange(90),
    );
    expect(r.from.toISOString().startsWith('2026-01-01')).toBe(true);
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
