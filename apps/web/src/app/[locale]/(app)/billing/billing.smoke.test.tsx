import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('billing page smoke', () => {
  it('has billing nav and page copy in both locales', () => {
    expect(en.nav.billing).toBeTruthy();
    expect(ar.nav.billing).toBeTruthy();
    expect(en.billing.title).toBeTruthy();
    expect(en.billing.upgradeTo).toBeTruthy();
    expect(en.billing.readOnlyWarning).toBeTruthy();
    expect(en.billing.status.READ_ONLY).toBeTruthy();
    expect(ar.billing.enterpriseTitle).toBeTruthy();
    expect(ar.billing.invoices).toBeTruthy();
    expect(ar.billing.whatsappUpgradeBody).toContain('واتساب');
    expect(ar.billing.whatsappUpgradeBody).toContain('{number}');
    expect(en.billing.whatsappUpgradeBody).toContain('WhatsApp');
    expect(en.billing.choosePlan).toBeTruthy();
    expect(ar.billing.choosePlan).toBeTruthy();
    expect(en.billing.startFreeTrial).toBeTruthy();
    expect(ar.billing.startFreeTrial).toContain('التجربة');
    expect(en.billing.subscribeWhatsApp).toContain('WhatsApp');
    expect(ar.auth.planBranchHint).toContain('واتساب');
    expect(en.billing.sendBlockedMessage).toContain('00201000864620');
    expect(ar.billing.sendBlockedMessage).toContain('واتساب');
    expect(en.billing.promoNote).toContain('{invoicePromo}');
    expect(ar.billing.cardPoints).toBeTruthy();
    expect(en.admin.tabAddons).toBeTruthy();
    expect(ar.admin.trialDays).toBeTruthy();
    expect(en.common.copy).toBeTruthy();
    expect(ar.common.tenantId).toBeTruthy();
  });
});
