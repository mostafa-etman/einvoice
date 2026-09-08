import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('platform admin page smoke', () => {
  it('has admin console copy in both locales', () => {
    expect(en.admin.title).toBeTruthy();
    expect(en.admin.provision).toBeTruthy();
    expect(en.admin.impersonate).toBeTruthy();
    expect(en.admin.accessDenied).toBeTruthy();
    expect(en.admin.searchPlaceholder.toLowerCase()).toContain('tenant id');
    expect(ar.admin.searchPlaceholder).toContain('معرّف');
    expect(en.common.tenantId).toBeTruthy();
    expect(ar.common.tenantId).toContain('مستأجر');
    expect(en.admin.adjustPoints).toBeTruthy();
    expect(en.admin.isActive).toBeTruthy();
    expect(en.admin.hideFromCustomers).toBeTruthy();
    expect(en.admin.tabTrials).toBeTruthy();
    expect(en.admin.etaTutorialVideoUrl).toContain('video');
    expect(ar.admin.etaTutorialVideoUrl).toBeTruthy();
    expect(en.admin.resetTrial).toBeTruthy();
    expect(ar.admin.tabTrials).toBeTruthy();
    expect(en.auth.trialAlreadyUsed).toContain('free trial');
    expect(ar.auth.trialAlreadyUsed).toContain('واتساب');
    expect(en.pending.whatsappPrompt).toContain('{number}');
    expect(ar.admin.approve).toBeTruthy();
    expect(ar.pending.whatsappPrompt).toContain('واتساب');
  });
});
