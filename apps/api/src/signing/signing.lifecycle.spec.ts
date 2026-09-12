import {
  isClaimLeaseActive,
  isPendingJobStale,
  PENDING_STALE_MS,
} from './signing.service';

describe('signature job lease helpers', () => {
  const now = new Date('2026-09-12T12:00:00.000Z');

  it('treats a future claimExpiresAt as an active lease', () => {
    expect(isClaimLeaseActive(new Date('2026-09-12T12:04:59.000Z'), now)).toBe(true);
    expect(isClaimLeaseActive(new Date('2026-09-12T11:59:59.000Z'), now)).toBe(false);
    expect(isClaimLeaseActive(null, now)).toBe(false);
  });

  it('treats PENDING with no progress for 30 minutes as stale', () => {
    expect(isPendingJobStale(new Date('2026-09-12T11:30:00.000Z'), now)).toBe(true);
    expect(isPendingJobStale(new Date('2026-09-12T11:30:01.000Z'), now)).toBe(false);
    expect(PENDING_STALE_MS).toBe(30 * 60 * 1000);
  });
});
