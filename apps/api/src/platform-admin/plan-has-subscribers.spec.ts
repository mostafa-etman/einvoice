import { PLAN_HAS_SUBSCRIBERS_CODE, planHasSubscribersBody } from './plan-has-subscribers';

describe('planHasSubscribersBody', () => {
  it('includes the account count in both locales', () => {
    const body = planHasSubscribersBody(3);
    expect(body.code).toBe(PLAN_HAS_SUBSCRIBERS_CODE);
    expect(body.subscriberCount).toBe(3);
    expect(body.messageEn).toContain('(3 accounts)');
    expect(body.messageAr).toContain('(3 حساب)');
    expect(body.message).toBe(body.messageEn);
  });
});
