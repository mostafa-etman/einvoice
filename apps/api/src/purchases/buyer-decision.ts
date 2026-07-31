/**
 * Pure buyer-decision transitions for received documents (Purchases).
 * Accept is local (+ optional decline-cancelation at ETA).
 * Reject / decline-cancelation call ETA via the lifecycle client.
 */

export type ReceivedBuyerDecision =
  | 'NONE'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'DECLINED_CANCELATION'
  | 'NEEDS_ATTENTION';

export type BuyerAction = 'ACCEPT' | 'REJECT' | 'DECLINE_CANCELATION';

export type BuyerDecisionTransition =
  | { ok: true; next: ReceivedBuyerDecision }
  | { ok: false; code: 'ALREADY_DECIDED' | 'REASON_REQUIRED' | 'INVALID_STATE'; message: string };

const TERMINAL: ReadonlySet<ReceivedBuyerDecision> = new Set([
  'ACCEPTED',
  'REJECTED',
  'DECLINED_CANCELATION',
]);

export function canRetryBuyerAction(current: ReceivedBuyerDecision): boolean {
  return current === 'NONE' || current === 'NEEDS_ATTENTION';
}

export function evaluateBuyerDecision(
  current: ReceivedBuyerDecision,
  action: BuyerAction,
  reason?: string | null,
): BuyerDecisionTransition {
  if (TERMINAL.has(current)) {
    return {
      ok: false,
      code: 'ALREADY_DECIDED',
      message: `Document already has terminal buyer decision: ${current}`,
    };
  }
  if (!canRetryBuyerAction(current)) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `Cannot ${action} from decision ${current}`,
    };
  }

  if (action === 'REJECT') {
    const r = String(reason ?? '').trim();
    if (!r) {
      return {
        ok: false,
        code: 'REASON_REQUIRED',
        message: 'Reject requires a non-empty reason',
      };
    }
    return { ok: true, next: 'REJECTED' };
  }

  if (action === 'ACCEPT') {
    return { ok: true, next: 'ACCEPTED' };
  }

  if (action === 'DECLINE_CANCELATION') {
    return { ok: true, next: 'DECLINED_CANCELATION' };
  }

  return {
    ok: false,
    code: 'INVALID_STATE',
    message: `Unknown action`,
  };
}

/** After a failed ETA call, mark needs attention while preserving retry. */
export function buyerDecisionAfterEtaFailure(
  _current: ReceivedBuyerDecision,
): ReceivedBuyerDecision {
  return 'NEEDS_ATTENTION';
}
