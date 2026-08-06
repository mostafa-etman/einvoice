import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('invoice numbering settings smoke', () => {
  it('has numbering labels in en + ar', () => {
    expect(en.settings.invoiceNumbering).toBeTruthy();
    expect(en.settingsNumbering.title).toBeTruthy();
    expect(en.settingsNumbering.prefix).toBeTruthy();
    expect(ar.settings.invoiceNumbering).toBeTruthy();
    expect(ar.settingsNumbering.scopeTenant).toBeTruthy();
  });
});

describe('receiver collapse + references labels', () => {
  it('has show/hide receiver and reference picker copy', () => {
    expect(en.documents.showReceiver).toBeTruthy();
    expect(en.documents.hideReceiver).toBeTruthy();
    expect(en.documents.referencesPick).toBeTruthy();
    expect(en.documents.referencesManual).toBeTruthy();
    expect(en.documents.internalIdHelp).toBeTruthy();
    expect(ar.documents.showReceiver).toBeTruthy();
    expect(ar.documents.referencesRequired).toBeTruthy();
    expect(ar.documents.referencesFormatHint).toContain('{value}');
  });
});
