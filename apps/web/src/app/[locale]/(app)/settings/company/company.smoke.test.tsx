import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('company settings smoke', () => {
  it('has company logo labels in en + ar', () => {
    for (const messages of [en, ar]) {
      expect(messages.settings.company).toBeTruthy();
      expect(messages.settingsCompany.title).toBeTruthy();
      expect(messages.settingsCompany.logo).toBeTruthy();
      expect(messages.settingsCompany.upload).toBeTruthy();
      expect(messages.settingsCompany.replace).toBeTruthy();
      expect(messages.settingsCompany.remove).toBeTruthy();
    }
  });
});

describe('local vs official printout labels', () => {
  it('distinguishes Preview / Print from Official printout', () => {
    expect(en.documents.previewPrint).toBeTruthy();
    expect(en.documents.downloadPrintout.toLowerCase()).toContain('eta');
    expect(en.documents.localPrintoutHint).toMatch(/local/i);
    expect(en.documents.officialPrintoutHint).toMatch(/ETA|official/i);
    expect(ar.documents.previewPrint).toBeTruthy();
    expect(ar.documents.downloadPrintout).toBeTruthy();
    expect(ar.documents.localPrintoutHint).toBeTruthy();
    expect(ar.documents.officialPrintoutHint).toBeTruthy();
  });
});
