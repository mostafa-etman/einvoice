import {
  evaluateCooldown,
  isCooldownClearable,
  isInFlightHeld,
  IN_FLIGHT_STALE_MS,
} from './submit-cooldown';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const now = Date.parse('2026-07-31T12:00:00Z');
const inFiveMin = new Date(now + 5 * 60_000);
const fiveMinAgo = new Date(now - 5 * 60_000);

describe('submit cooldown gating', () => {
  it('does not block when no cooldown is stored', () => {
    const d = evaluateCooldown({ until: null, payloadHash: null }, HASH_A, now);
    expect(d.blocked).toBe(false);
  });

  it('blocks the same document + same payload inside the window', () => {
    const d = evaluateCooldown(
      { until: inFiveMin, payloadHash: HASH_A },
      HASH_A,
      now,
    );
    expect(d).toMatchObject({ blocked: true, remainingSeconds: 300 });
  });

  it('auto-expires once the window elapses (no manual reset)', () => {
    const d = evaluateCooldown(
      { until: fiveMinAgo, payloadHash: HASH_A },
      HASH_A,
      now,
    );
    expect(d).toEqual({ blocked: false, reason: 'expired' });
  });

  it('never blocks a different payload — a cooldown on A cannot block B', () => {
    const d = evaluateCooldown(
      { until: inFiveMin, payloadHash: HASH_A },
      HASH_B,
      now,
    );
    expect(d).toEqual({ blocked: false, reason: 'payload_changed' });
  });

  it('still blocks legacy rows without a payload hash while the window is open', () => {
    const d = evaluateCooldown(
      { until: inFiveMin, payloadHash: null },
      HASH_B,
      now,
    );
    expect(d.blocked).toBe(true);
  });

  it('marks expired or payload-changed cooldowns as clearable', () => {
    expect(
      isCooldownClearable({ until: fiveMinAgo, payloadHash: HASH_A }, HASH_A, now),
    ).toBe(true);
    expect(
      isCooldownClearable({ until: inFiveMin, payloadHash: HASH_A }, HASH_B, now),
    ).toBe(true);
    expect(
      isCooldownClearable({ until: inFiveMin, payloadHash: HASH_A }, HASH_A, now),
    ).toBe(false);
    expect(isCooldownClearable({ until: null, payloadHash: null }, HASH_A, now)).toBe(
      false,
    );
  });

  it('honours a fresh in-flight lock and releases a stale one', () => {
    expect(isInFlightHeld(false, null, now)).toBe(false);
    expect(isInFlightHeld(true, new Date(now - 1_000), now)).toBe(true);
    expect(
      isInFlightHeld(true, new Date(now - IN_FLIGHT_STALE_MS - 1), now),
    ).toBe(false);
    // Pre-fix rows have no timestamp — never block forever on them.
    expect(isInFlightHeld(true, null, now)).toBe(false);
  });
});
