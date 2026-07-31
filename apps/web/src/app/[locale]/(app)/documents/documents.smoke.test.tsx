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
    expect(ar.documents.taxSubtypeMismatch).toContain('{subType}');
    expect(ar.documents.save).toBeTruthy();
    expect(ar.documents.taxModeNone).toBeTruthy();
    expect(ar.documents.serviceDeliveryDate).toBeTruthy();
    expect(ar.nav.documents).toBeTruthy();
  });
});
