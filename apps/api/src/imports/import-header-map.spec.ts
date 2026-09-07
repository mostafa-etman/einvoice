import { proposeColumnMapping, resolveImportFieldKey } from './import-header-map';
import { arabicHeaderForField } from './import-ar-headers';
import { applyMapping } from './import-validate.service';
import { normalizeMappedImportValues } from './import-value-aliases';
import { IMPORT_REQUIRED_FIELDS } from './import-schema';

describe('Arabic import headers', () => {
  it('maps Arabic starred headers and English keys to the same fields', () => {
    expect(resolveImportFieldKey(arabicHeaderForField('internalID', true))).toBe(
      'internalID',
    );
    expect(resolveImportFieldKey('internalID')).toBe('internalID');
    expect(resolveImportFieldKey('رقم تسجيل المستلم')).toBe('receiverId');
    expect(resolveImportFieldKey('نوع الضريبة 1 (*)')).toBe('taxType1');
    expect(resolveImportFieldKey('عملة البيع')).toBe('currencyCode');
    expect(resolveImportFieldKey('العملة')).toBe('currencyCode');
  });

  it('auto-maps a full Arabic template header row including required fields', () => {
    const headers = IMPORT_REQUIRED_FIELDS.map((f) =>
      arabicHeaderForField(f, true),
    );
    const mapping = proposeColumnMapping(headers);
    for (const field of IMPORT_REQUIRED_FIELDS) {
      expect(mapping[field]).toBeTruthy();
    }
  });

  it('still auto-maps legacy English templates', () => {
    const mapping = proposeColumnMapping([...IMPORT_REQUIRED_FIELDS]);
    expect(mapping.internalID).toBe('internalID');
    expect(mapping.unitPrice).toBe('unitPrice');
  });

  it('normalizes Arabic list values into ETA codes', () => {
    const mapped = applyMapping(
      {
        [arabicHeaderForField('internalID', true)]: 'INV-1',
        [arabicHeaderForField('receiverType', false)]: 'شركة',
        [arabicHeaderForField('taxType1', false)]: 'T1 — ضريبة القيمة المضافة',
        [arabicHeaderForField('taxSubType1', false)]: 'V009 — سلع عامة',
        [arabicHeaderForField('documentType', false)]: 'مرتجع',
        [arabicHeaderForField('receiverCountry', false)]: 'EG — مصر',
      },
      proposeColumnMapping([
        arabicHeaderForField('internalID', true),
        arabicHeaderForField('receiverType', false),
        arabicHeaderForField('taxType1', false),
        arabicHeaderForField('taxSubType1', false),
        arabicHeaderForField('documentType', false),
        arabicHeaderForField('receiverCountry', false),
      ]),
    );
    const norm = normalizeMappedImportValues(mapped);
    expect(norm.receiverType).toBe('B');
    expect(norm.taxType1).toBe('T1');
    expect(norm.taxSubType1).toBe('V009');
    expect(norm.documentType).toBe('C');
    expect(norm.receiverCountry).toBe('EG');
  });
});
