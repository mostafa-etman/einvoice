/**
 * ETA duplicate-submission cooldown gating.
 *
 * ETA's DuplicateSubmission 422 is scoped to an exact payload ("identical to a
 * previous payload sent in the last 10 Min"), so our cooldown is keyed by
 * document AND the payload hash ETA flagged, and it always auto-expires.
 *
 * A cooldown must never block:
 *  - a different document, or
 *  - the same document once the Retry-After window has elapsed, or
 *  - the same document after its payload changed (different bytes = not a duplicate).
 */

/** A crashed/restarted process must not hold a submit lock forever. */
export const IN_FLIGHT_STALE_MS = 5 * 60_000;

export type CooldownState = {
  /** Instant the ETA duplicate window expires. */
  until: Date | null;
  /** Canonical payload digest ETA rejected as duplicate (null = legacy row). */
  payloadHash: string | null;
};

export type CooldownDecision =
  | { blocked: false; reason: 'no_cooldown' | 'expired' | 'payload_changed' }
  | { blocked: true; reason: 'active'; remainingSeconds: number; until: Date };

/**
 * Decide whether THIS document's cooldown still blocks THIS payload.
 * `currentPayloadHash` is the digest of the payload about to be POSTed.
 */
export function evaluateCooldown(
  state: CooldownState,
  currentPayloadHash: string | null,
  nowMs: number = Date.now(),
): CooldownDecision {
  if (!state.until) return { blocked: false, reason: 'no_cooldown' };

  if (state.until.getTime() <= nowMs) {
    return { blocked: false, reason: 'expired' };
  }

  // Different bytes than the ones ETA flagged — ETA would not call it a duplicate.
  if (
    state.payloadHash &&
    currentPayloadHash &&
    state.payloadHash !== currentPayloadHash
  ) {
    return { blocked: false, reason: 'payload_changed' };
  }

  return {
    blocked: true,
    reason: 'active',
    remainingSeconds: Math.ceil((state.until.getTime() - nowMs) / 1000),
    until: state.until,
  };
}

/** True when a stored cooldown can be cleared from the row (no longer applies). */
export function isCooldownClearable(
  state: CooldownState,
  currentPayloadHash: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!state.until) return false;
  return !evaluateCooldown(state, currentPayloadHash, nowMs).blocked;
}

/**
 * An in-flight flag is only honoured while it is fresh; rows without a
 * timestamp predate the fix and are treated as stale.
 */
export function isInFlightHeld(
  submitInFlight: boolean,
  since: Date | null,
  nowMs: number = Date.now(),
  staleMs: number = IN_FLIGHT_STALE_MS,
): boolean {
  if (!submitInFlight) return false;
  if (!since) return false;
  return nowMs - since.getTime() < staleMs;
}
