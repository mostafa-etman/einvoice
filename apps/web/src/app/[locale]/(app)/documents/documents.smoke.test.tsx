import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('documents smoke', () => {
  it('has documents authoring labels', () => {
    expect(en.documents.new).toBeTruthy();
    expect(en.documents.lines).toBeTruthy();
    expect(en.documents.taxpayerActivityCode).toBeTruthy();
    expect(en.documents.searchActivity).toBeTruthy();
    expect(en.documents.sectionReceiver).toBeTruthy();
    expect(en.documents.taxModeTaxable).toBeTruthy();
    expect(en.documents.taxModeZeroOrExempt).toBeTruthy();
    expect(en.documents.taxModeNone).toBeTruthy();
    expect(en.documents.taxKindZeroRated).toBeTruthy();
    expect(en.documents.taxKindExempt).toBeTruthy();
    expect(en.documents.taxSubtypeMismatch).toContain('{subType}');
    expect(en.documents.duplicateTaxType).toContain('{taxTypes}');
    expect(en.documents.sendSelected).toBeTruthy();
    expect(en.documents.refreshSelected).toBeTruthy();
    expect(en.documents.refreshAllPending).toBeTruthy();
    expect(en.documents.cancelSelected).toBeTruthy();
    expect(en.documents.downloadEtaSource).toBeTruthy();
    expect(en.documents.downloadPrintout).toBeTruthy();
    expect(en.documents.lateSubmitConfirm).toContain('{days}');
    expect(en.documents.batchSendSummary).toContain('{sent}');
    expect(en.documents.lastChecked).toContain('{when}');
    expect(ar.documents.sendSelected).toBeTruthy();
    expect(ar.documents.cancelSelected).toBeTruthy();
    expect(ar.documents.downloadEtaSource).toBeTruthy();
    expect(ar.documents.refreshAllPending).toBeTruthy();
    expect(ar.documents.lateSubmitConfirm).toContain('{days}');
    expect(ar.documents.taxSubtypeMismatch).toContain('{subType}');
    expect(ar.documents.save).toBeTruthy();
    expect(ar.documents.taxModeNone).toBeTruthy();
    expect(ar.documents.serviceDeliveryDate).toBeTruthy();
    expect(ar.nav.documents).toBeTruthy();
  });

  it('has add/remove line labels in both locales', () => {
    expect(en.documents.addLine).toBeTruthy();
    expect(en.documents.removeLine).toBeTruthy();
    expect(en.documents.noLines).toBeTruthy();
    expect(en.documents.lineNumber).toContain('{number}');
    expect(en.documents.removeLineAria).toContain('{number}');
    expect(ar.documents.addLine).toBeTruthy();
    expect(ar.documents.removeLine).toBeTruthy();
    expect(ar.documents.noLines).toBeTruthy();
    expect(ar.documents.lineNumber).toContain('{number}');
    expect(ar.documents.removeLineAria).toContain('{number}');
  });
});
