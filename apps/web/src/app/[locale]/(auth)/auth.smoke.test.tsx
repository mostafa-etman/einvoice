import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('auth pages smoke', () => {
  it('exposes login/register/onboarding copy', () => {
    expect(en.auth.loginTitle).toBeTruthy();
    expect(en.auth.registerTitle).toBeTruthy();
    expect(en.auth.onboardingTitle).toBeTruthy();
    expect(en.auth.planBranchHint).toContain('trial');
    expect(ar.auth.planBranchHint).toContain('واتساب');
    expect(ar.auth.trialHint).toContain('التجريبية');
    expect(ar.auth.loginTitle).toBeTruthy();
    expect(ar.auth.submitLogin).not.toEqual(en.auth.submitLogin);
  });
});
