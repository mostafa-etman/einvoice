import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deductibleTaxTypesFromCatalog,
  ETA_DEDUCTIBLE_TAX_TYPES,
  etaTaxDirection,
  etaTaxSign,
  isDeductibleTaxType,
  isFixedAmountTaxType,
  isNonTaxableFeeTaxType,
  isTaxableFeeTaxType,
  isWithholdingCatalogEntry,
  type EtaTaxTypeCatalogEntry,
} from './tax-modes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ETA_CODES = join(__dirname, '../../../apps/api/data/eta-codes');

type RawCatalogRow = { Code: string; Desc_en?: string; Desc_ar?: string };

function loadCatalog(file: string): EtaTaxTypeCatalogEntry[] {
  const rows = JSON.parse(readFileSync(join(ETA_CODES, file), 'utf8')) as RawCatalogRow[];
  return rows.map((r) => ({ code: r.Code, descEn: r.Desc_en, descAr: r.Desc_ar }));
}

describe('ETA tax direction (additive vs deductible)', () => {
  const catalog = [
    ...loadCatalog('TaxTypes.json'),
    ...loadCatalog('NonTaxableTaxTypes.json'),
  ];

  it('covers the full T1-T20 catalog', () => {
    expect(catalog.map((c) => c.code)).toEqual(
      Array.from({ length: 20 }, (_, i) => `T${i + 1}`),
    );
  });

  it('derives the deductible set from the seeded ETA catalog, not a guess', () => {
    expect(deductibleTaxTypesFromCatalog(catalog)).toEqual([
      ...ETA_DEDUCTIBLE_TAX_TYPES,
    ]);
  });

  it('recognises T4 as withholding from both the English and Arabic labels', () => {
    const t4 = catalog.find((c) => c.code === 'T4')!;
    expect(t4.descEn).toMatch(/Withholding tax/i);
    expect(isWithholdingCatalogEntry({ code: 'T4', descEn: t4.descEn })).toBe(true);
    expect(isWithholdingCatalogEntry({ code: 'T4', descAr: t4.descAr })).toBe(true);
  });

  it('classifies every ETA tax type: only T4 reduces the total', () => {
    for (const { code } of catalog) {
      const expected = code === 'T4' ? 'deductible' : 'additive';
      expect([code, etaTaxDirection(code)]).toEqual([code, expected]);
    }
    expect(etaTaxSign('T1')).toBe(1);
    expect(etaTaxSign('T4')).toBe(-1);
    expect(isDeductibleTaxType('t4')).toBe(true);
    expect(isDeductibleTaxType(' T4 ')).toBe(true);
  });

  it('groups fee and fixed-amount types the way ETA bases the calculation', () => {
    expect(['T5', 'T8', 'T12'].every(isTaxableFeeTaxType)).toBe(true);
    expect(['T1', 'T4', 'T13'].some(isTaxableFeeTaxType)).toBe(false);
    expect(['T13', 'T20'].every(isNonTaxableFeeTaxType)).toBe(true);
    expect(['T3', 'T6'].every(isFixedAmountTaxType)).toBe(true);
    expect(isFixedAmountTaxType('T14')).toBe(false);
  });

  it('treats an unknown tax type as additive rather than silently deducting', () => {
    expect(etaTaxDirection('T99')).toBe('additive');
  });
});
