import { localizedTaxTypeLabel, taxTypeLabelFromRows } from './c4-tax-label';

describe('localizedTaxTypeLabel', () => {
  it('uses Arabic then English then the stored code', () => {
    expect(
      localizedTaxTypeLabel('ar', 'T1', 'Value added tax', 'ضريبة القيمة المضافة'),
    ).toBe('ضريبة القيمة المضافة');
    expect(
      localizedTaxTypeLabel('en', 'T1', 'Value added tax', 'ضريبة القيمة المضافة'),
    ).toBe('Value added tax');
  });

  it('falls back safely for unknown or empty values', () => {
    expect(localizedTaxTypeLabel('ar', 'T99', '', '')).toBe('T99');
    expect(localizedTaxTypeLabel('en', 'T99', null, undefined)).toBe('T99');
    expect(localizedTaxTypeLabel('ar', null, '', '')).toBe('—');
    expect(localizedTaxTypeLabel('en', 'T4', '', 'الخصم تحت حساب الضريبه')).toBe(
      'الخصم تحت حساب الضريبه',
    );
  });
});

describe('taxTypeLabelFromRows', () => {
  const rows = [
    {
      taxType: 'T1',
      taxTypeNameEn: 'Value added tax',
      taxTypeNameAr: 'ضريبة القيمة المضافة',
    },
  ];

  it('looks up the catalog name from C4 rows without changing the code', () => {
    expect(taxTypeLabelFromRows('ar', 'T1', rows)).toBe('ضريبة القيمة المضافة');
    expect(taxTypeLabelFromRows('en', 'T1', rows)).toBe('Value added tax');
    expect(taxTypeLabelFromRows('ar', 'T2', rows)).toBe('T2');
  });
});
