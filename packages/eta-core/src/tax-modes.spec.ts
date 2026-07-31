import {
  compareEtaCodes,
  defaultTaxableTax,
  documentKindTypicallyRequiresTax,
  exemptTax,
  ETA_EXEMPT_SUBTYPES,
  ETA_STANDARD_TAXABLE_SUBTYPE,
  ETA_VAT_TAX_TYPE,
  ETA_ZERO_RATED_SUBTYPES,
  findDuplicateTaxTypes,
  firstSubtypeForTaxType,
  inferLineTaxMode,
  isExemptSubtype,
  isFullyTaxFree,
  isSubtypeOfTaxType,
  isZeroRatedSubtype,
  nextUnusedTaxType,
  subtypesForTaxType,
  taxesForMode,
  zeroRatedTax,
} from './tax-modes.js';

/** Mirrors the seeded TaxSubtypes.json parent links used in these cases. */
const SUBTYPES = [
  { code: 'V009', parentCode: 'T1' },
  { code: 'V001', parentCode: 'T1' },
  { code: 'Tbl01', parentCode: 'T2' },
  { code: 'Tbl02', parentCode: 'T3' },
  { code: 'Mn01', parentCode: 'T10' },
  { code: 'Mn02', parentCode: 'T10' },
];
const TAX_TYPES = [
  { code: 'T1' },
  { code: 'T10' },
  { code: 'T2' },
  { code: 'T3' },
];

describe('tax-modes', () => {
  it('uses only seeded zero-rated and exempt subtype codes', () => {
    expect(ETA_ZERO_RATED_SUBTYPES).toEqual(['V001', 'V002']);
    expect(ETA_EXEMPT_SUBTYPES).toContain('V003');
    expect(ETA_EXEMPT_SUBTYPES).toContain('V004');
    expect(ETA_STANDARD_TAXABLE_SUBTYPE).toBe('V009');
  });

  it('builds zero-rated and exempt entries at rate 0 under T1', () => {
    expect(zeroRatedTax('V001')).toEqual({
      taxType: ETA_VAT_TAX_TYPE,
      subType: 'V001',
      rate: '0',
    });
    expect(exemptTax('V003')).toEqual({
      taxType: ETA_VAT_TAX_TYPE,
      subType: 'V003',
      rate: '0',
    });
    expect(() => zeroRatedTax('V009')).toThrow(/zero-rated/);
    expect(() => exemptTax('V001')).toThrow(/exempt/);
  });

  it('infers mode from persisted taxes', () => {
    expect(inferLineTaxMode([])).toBe('none');
    expect(inferLineTaxMode(undefined)).toBe('none');
    expect(inferLineTaxMode([zeroRatedTax('V002')])).toBe('zero_rated');
    expect(inferLineTaxMode([exemptTax('V003')])).toBe('exempt');
    expect(inferLineTaxMode([defaultTaxableTax()])).toBe('taxable');
  });

  it('taxesForMode produces empty array for no-tax', () => {
    expect(taxesForMode('none')).toEqual([]);
    expect(taxesForMode('zero_rated', { zeroRatedSubtype: 'V001' })[0]!.rate).toBe(
      '0',
    );
    expect(taxesForMode('exempt', { exemptSubtype: 'V003' })[0]!.subType).toBe(
      'V003',
    );
  });

  it('finds duplicate TaxTypes on a line', () => {
    expect(
      findDuplicateTaxTypes([
        { taxType: 'T1', subType: 'V009', rate: '14' },
        { taxType: 'T1', subType: 'V010', rate: '5' },
      ]),
    ).toEqual(['T1']);
    expect(
      findDuplicateTaxTypes([
        { taxType: 'T1', subType: 'V009', rate: '14' },
        { taxType: 'T2', subType: 'Tbl01', rate: '5' },
      ]),
    ).toEqual([]);
  });

  it('offers only subtypes whose parent is the selected tax type', () => {
    expect(subtypesForTaxType(SUBTYPES, 'T3').map((s) => s.code)).toEqual(['Tbl02']);
    expect(subtypesForTaxType(SUBTYPES, 'T10').map((s) => s.code)).toEqual([
      'Mn01',
      'Mn02',
    ]);
    // Mn01 belongs to T10, so it must never be valid under T3.
    expect(isSubtypeOfTaxType(SUBTYPES, 'T3', 'Mn01')).toBe(false);
    expect(isSubtypeOfTaxType(SUBTYPES, 'T3', 'Tbl02')).toBe(true);
    expect(firstSubtypeForTaxType(SUBTYPES, 'T3')).toBe('Tbl02');
  });

  it('orders codes naturally so T2 follows T1 (not T10)', () => {
    expect(compareEtaCodes('T2', 'T10')).toBeLessThan(0);
    expect(nextUnusedTaxType(TAX_TYPES, ['T1'])).toBe('T2');
    expect(nextUnusedTaxType(TAX_TYPES, ['T1', 'T2', 'T3'])).toBe('T10');
    expect(nextUnusedTaxType(TAX_TYPES, ['T1', 'T2', 'T3', 'T10'])).toBeNull();
  });

  it('classifies subtypes and tax-free invoices', () => {
    expect(isZeroRatedSubtype('V001')).toBe(true);
    expect(isExemptSubtype('V003')).toBe(true);
    expect(documentKindTypicallyRequiresTax('INVOICE')).toBe(true);
    expect(documentKindTypicallyRequiresTax('EXPORT_INVOICE')).toBe(false);
    expect(isFullyTaxFree([{ taxes: [] }, { taxes: undefined }])).toBe(true);
    expect(isFullyTaxFree([{ taxes: [defaultTaxableTax()] }])).toBe(false);
  });
});
