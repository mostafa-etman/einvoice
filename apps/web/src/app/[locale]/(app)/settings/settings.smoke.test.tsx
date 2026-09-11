import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('settings hub smoke', () => {
  it('has settings nav and hub copy in both locales', () => {
    expect(en.nav.settings).toBeTruthy();
    expect(ar.nav.settings).toBeTruthy();
    expect(en.settings.title).toBeTruthy();
    expect(ar.settings.hubIntro).toBeTruthy();
    expect(en.settings.groupCompany).toBeTruthy();
    expect(en.settings.groupEta).toBeTruthy();
    expect(en.settings.groupCatalog).toBeTruthy();
    expect(ar.settings.groupCompany).toBeTruthy();
    expect(ar.settings.groupEta).toBeTruthy();
    expect(ar.settings.groupCatalog).toBeTruthy();
  });
});
