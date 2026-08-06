import { nextBackoffMs } from './sync-engine';

describe('sync-engine backoff (T016)', () => {
  it('doubles until max', () => {
    expect(nextBackoffMs(0, 1000, 60_000)).toBe(1000);
    expect(nextBackoffMs(1, 1000, 60_000)).toBe(2000);
    expect(nextBackoffMs(2, 1000, 60_000)).toBe(4000);
    expect(nextBackoffMs(10, 1000, 60_000)).toBe(60_000);
  });
});
