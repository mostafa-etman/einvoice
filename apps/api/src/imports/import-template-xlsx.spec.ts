import { Workbook } from 'exceljs';
import * as XLSX from 'xlsx';
import { buildImportTemplateXlsx } from './import-template-xlsx';
import { parseXlsxBuffer, pickImportSheetName } from './import-parse.service';
import { proposeColumnMapping } from './import-header-map';
import { applyMapping } from './import-validate.service';
import { normalizeMappedImportValues } from './import-value-aliases';
import { IMPORT_ALL_FIELD_KEYS, IMPORT_TAX_SLOTS } from './import-schema';
import {
  NAMED,
  TEMPLATE_SHEET_INVOICES,
  TEMPLATE_SHEET_LISTS,
} from './import-lists';

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fieldCol(key: string): string {
  const i = IMPORT_ALL_FIELD_KEYS.indexOf(key);
  if (i < 0) throw new Error(`missing field ${key}`);
  return colLetter(i);
}

describe('import Excel template (ExcelJS)', () => {
  let buf: Buffer;
  let wb: Workbook;

  beforeAll(async () => {
    buf = await buildImportTemplateXlsx();
    wb = new Workbook();
    await wb.xlsx.load(buf as never);
  });

  it('exposes only Invoices as a visible sheet; Lists is hidden; Notes is absent', () => {
    const names = wb.worksheets.map((s) => s.name);
    expect(names).toContain(TEMPLATE_SHEET_INVOICES);
    expect(names).toContain(TEMPLATE_SHEET_LISTS);
    expect(names).not.toContain('Notes');
    expect(names).not.toContain('Import');
    expect(wb.getWorksheet(TEMPLATE_SHEET_INVOICES)?.state).toBe('visible');
    expect(wb.getWorksheet(TEMPLATE_SHEET_LISTS)?.state).toBe('hidden');
    expect(wb.worksheets.filter((s) => s.state === 'visible').map((s) => s.name)).toEqual([
      TEMPLATE_SHEET_INVOICES,
    ]);
  });

  it('writes workbook-scoped named ranges used by hidden Lists dropdowns', () => {
    const names = new Set(wb.definedNames.model.map((n) => n.name));
    expect(names.has(NAMED.receiverType)).toBe(true);
    expect(names.has(NAMED.country)).toBe(true);
    expect(names.has(NAMED.taxType)).toBe(true);
    expect(names.has(NAMED.taxMap)).toBe(true);
    expect(names.has('TaxSub_T1')).toBe(true);
    expect(names.has('TaxSub_T2')).toBe(true);
    expect(names.has('TaxSub_T4')).toBe(true);
    const t1 = wb.definedNames.getRanges('TaxSub_T1');
    expect(t1.ranges.join(',')).toMatch(/Lists/i);
  });

  it('enforces list data validation with a stop error on locked columns', () => {
    const invoices = wb.getWorksheet(TEMPLATE_SHEET_INVOICES)!;
    const receiver = invoices.getCell(`${fieldCol('receiverType')}2`).dataValidation;
    expect(receiver.type).toBe('list');
    expect(receiver.formulae[0]).toBe(NAMED.receiverType);
    expect(receiver.showErrorMessage).toBe(true);
    expect(String(receiver.errorStyle)).toBe('stop');
    expect(String(receiver.error ?? '')).toContain('القائمة');

    const country = invoices.getCell(`${fieldCol('receiverCountry')}2`).dataValidation;
    expect(country.formulae[0]).toBe(NAMED.country);

    const unit = invoices.getCell(`${fieldCol('unitType')}2`).dataValidation;
    expect(unit.formulae[0]).toBe(NAMED.unitType);

    const currency = invoices.getCell(`${fieldCol('currencyCode')}2`).dataValidation;
    expect(currency.formulae[0]).toBe(NAMED.currency);

    const itemType = invoices.getCell(`${fieldCol('itemType')}2`).dataValidation;
    expect(itemType.formulae[0]).toBe(NAMED.itemType);
  });

  it('uses INDIRECT+VLOOKUP so subtype lists depend on the tax type in the same row', () => {
    const invoices = wb.getWorksheet(TEMPLATE_SHEET_INVOICES)!;
    for (let n = 1; n <= 3; n++) {
      const typeCol = fieldCol(`taxType${n}`);
      const subCol = fieldCol(`taxSubType${n}`);
      const typeDv = invoices.getCell(`${typeCol}2`).dataValidation;
      expect(typeDv.formulae[0]).toBe(NAMED.taxType);
      expect(typeDv.showErrorMessage).toBe(true);

      const subDv = invoices.getCell(`${subCol}2`).dataValidation;
      const formula = String(subDv.formulae[0] ?? '');
      expect(formula).toContain('INDIRECT');
      expect(formula).toContain('VLOOKUP');
      expect(formula).toContain(`${typeCol}2`);
      expect(formula).toContain(NAMED.taxMap);
      expect(subDv.showErrorMessage).toBe(true);
      expect(String(subDv.errorStyle)).toBe('stop');
    }
  });

  it('keeps three tax slots on the sample line and the importer still parses them', async () => {
    const rows: Record<string, string>[] = [];
    await parseXlsxBuffer(buf, {
      onRow: (r) => {
        rows.push(r.cells);
      },
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const mapping = proposeColumnMapping(Object.keys(rows[0] ?? {}));
    expect(mapping.internalID).toBeTruthy();
    expect(mapping.taxType1).toBeTruthy();
    expect(mapping.taxSubType1).toBeTruthy();
    expect(mapping.taxType2).toBeTruthy();
    expect(mapping.taxType3).toBeTruthy();

    const line2 = normalizeMappedImportValues(applyMapping(rows[1]!, mapping));
    expect(line2.receiverType).toBe('B');
    expect(line2.taxType1).toBe('T1');
    expect(line2.taxSubType1).toBe('V009');
    expect(line2.taxType2).toBe('T4');
    expect(line2.taxSubType2).toBe('W001');
    expect(line2.taxType3).toBe('T2');
    expect(line2.taxSubType3).toBe('Tbl01');
    expect(IMPORT_TAX_SLOTS).toBeGreaterThanOrEqual(3);
  });

  it('picks Invoices over Lists, and still accepts legacy Import sheet names', () => {
    expect(pickImportSheetName(['Lists', 'Invoices'])).toBe('Invoices');
    expect(pickImportSheetName(['Notes', 'Lists', 'Import'])).toBe('Import');
  });

  it('SheetJS still sees Invoices first and pickImportSheetName ignores Lists', () => {
    const xlsx = XLSX.read(buf, { type: 'buffer' });
    expect(pickImportSheetName(xlsx.SheetNames)).toBe(TEMPLATE_SHEET_INVOICES);
    expect(xlsx.SheetNames).toEqual(
      expect.arrayContaining([TEMPLATE_SHEET_INVOICES, TEMPLATE_SHEET_LISTS]),
    );
    const raw = XLSX.utils.sheet_to_json<string[]>(xlsx.Sheets.Invoices!, {
      header: 1,
    });
    const headers = (raw[0] ?? []).map((h) => String(h ?? ''));
    expect(headers.some((h) => h.includes('الرقم الداخلي'))).toBe(true);
    expect(headers.some((h) => h.includes('نوع الضريبة 1'))).toBe(true);
    expect(headers.some((h) => h.includes('النوع الفرعي 3'))).toBe(true);
    expect(headers.some((h) => h.includes('عملة البيع'))).toBe(true);
  });
});
