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
  });
});
