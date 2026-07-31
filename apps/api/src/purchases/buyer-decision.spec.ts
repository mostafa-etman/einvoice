import {
  buyerDecisionAfterEtaFailure,
  canRetryBuyerAction,
  evaluateBuyerDecision,
} from './buyer-decision';

describe('buyer-decision', () => {
  it('allows accept and reject from NONE', () => {
    expect(evaluateBuyerDecision('NONE', 'ACCEPT')).toEqual({
      ok: true,
      next: 'ACCEPTED',
    });
    expect(evaluateBuyerDecision('NONE', 'REJECT', 'Wrong amount')).toEqual({
      ok: true,
      next: 'REJECTED',
    });
    expect(evaluateBuyerDecision('NONE', 'DECLINE_CANCELATION')).toEqual({
      ok: true,
      next: 'DECLINED_CANCELATION',
    });
  });

  it('requires reason for reject', () => {
    expect(evaluateBuyerDecision('NONE', 'REJECT', '')).toMatchObject({
      ok: false,
      code: 'REASON_REQUIRED',
    });
    expect(evaluateBuyerDecision('NONE', 'REJECT', '   ')).toMatchObject({
      ok: false,
      code: 'REASON_REQUIRED',
    });
  });

  it('blocks conflicting actions on terminal decisions', () => {
    for (const terminal of ['ACCEPTED', 'REJECTED', 'DECLINED_CANCELATION'] as const) {
      expect(evaluateBuyerDecision(terminal, 'ACCEPT')).toMatchObject({
        ok: false,
        code: 'ALREADY_DECIDED',
      });
      expect(
        evaluateBuyerDecision(terminal, 'REJECT', 'again'),
      ).toMatchObject({ ok: false, code: 'ALREADY_DECIDED' });
      expect(canRetryBuyerAction(terminal)).toBe(false);
    }
  });

  it('allows retry from NEEDS_ATTENTION after ETA failure', () => {
    expect(buyerDecisionAfterEtaFailure('NONE')).toBe('NEEDS_ATTENTION');
    expect(canRetryBuyerAction('NEEDS_ATTENTION')).toBe(true);
    expect(evaluateBuyerDecision('NEEDS_ATTENTION', 'ACCEPT')).toEqual({
      ok: true,
      next: 'ACCEPTED',
    });
    expect(
      evaluateBuyerDecision('NEEDS_ATTENTION', 'REJECT', 'still wrong'),
    ).toEqual({ ok: true, next: 'REJECTED' });
  });
});
