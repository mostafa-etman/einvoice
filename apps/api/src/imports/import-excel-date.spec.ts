import { Workbook } from 'exceljs';
import * as XLSX from 'xlsx';
import {
  excelCellToImportString,
  excelSerialToUtcDate,
  invalidImportDateMessage,
  isPrismaDateTimeError,
  looksLikeExcelSerial,
  normalizeImportDate,
} from './import-excel-date';
import { parseXlsxBuffer } from './import-parse.service';
import { validateMappedRow } from './import-validate.service';
import {
  buildDocumentUpsert,
  groupRowsByInternalId,
} from './import-document-builder';

function baseRow(dateTimeIssued: string): Record<string, string> {
  return {
    internalID: 'INV-DATE-1',
    dateTimeIssued,
    receiverId: '123456789',
    receiverName: 'Buyer',
    description: 'Item',
    itemCode: 'EGS-1',
    quantity: '1',
    unitPrice: '10',
  };
}

describe('import Excel date normalization', () => {
  it('converts an Excel Date object', () => {
    const d = new Date('2026-07-01T00:00:00.000Z');
    const n = normalizeImportDate(d);
    expect(n.status).toBe('ok');
    if (n.status !== 'ok') return;
    expect(n.iso).toBe('2026-07-01T00:00:00.000Z');
    expect(n.ymd).toBe('2026-07-01');
  });

  it('converts Excel serial 46277 to 2026-09-12 (not year 46277)', () => {
    expect(excelSerialToUtcDate(46277)?.toISOString()).toBe(
      '2026-09-12T00:00:00.000Z',
    );
    expect(looksLikeExcelSerial(46277)).toBe(true);
    const n = normalizeImportDate('46277');
    expect(n.status).toBe('ok');
    if (n.status !== 'ok') return;
    expect(n.iso).toBe('2026-09-12T00:00:00.000Z');
    expect(n.date.getUTCFullYear()).toBe(2026);
  });

  it('converts Excel serial equivalents of 2026-01-01 / 2026-07-01 / 2026-09-12', () => {
    expect(normalizeImportDate(46023)).toMatchObject({
      status: 'ok',
      iso: '2026-01-01T00:00:00.000Z',
    });
    expect(normalizeImportDate(46204)).toMatchObject({
      status: 'ok',
      iso: '2026-07-01T00:00:00.000Z',
    });
    expect(normalizeImportDate(46277.5)).toMatchObject({
      status: 'ok',
      iso: '2026-09-12T12:00:00.000Z',
    });
  });

  it('keeps ISO strings and date-only values', () => {
    expect(normalizeImportDate('2026-01-01')).toMatchObject({
      status: 'ok',
      ymd: '2026-01-01',
    });
    expect(normalizeImportDate('2026-07-01')).toMatchObject({
      status: 'ok',
      iso: '2026-07-01T00:00:00.000Z',
    });
    expect(normalizeImportDate('2026-07-01T00:00:00.000Z')).toMatchObject({
      status: 'ok',
      iso: '2026-07-01T00:00:00.000Z',
    });
    expect(normalizeImportDate('2026-09-12T00:00:00.000Z')).toMatchObject({
      status: 'ok',
      iso: '2026-09-12T00:00:00.000Z',
    });
  });

  it('parses 01/07/2026 as 1 July (DD/MM), not 7 January (JS Date.parse)', () => {
    expect(new Date('01/07/2026').getUTCFullYear()).toBe(2026);
    expect(new Date('01/07/2026').getUTCMonth()).toBe(0);
    expect(normalizeImportDate('01/07/2026')).toMatchObject({
      status: 'ok',
      iso: '2026-07-01T00:00:00.000Z',
      ymd: '2026-07-01',
    });
    expect(normalizeImportDate('1/7/2026')).toMatchObject({
      status: 'ok',
      ymd: '2026-07-01',
    });
    expect(normalizeImportDate('31/12/2026')).toMatchObject({
      status: 'ok',
      ymd: '2026-12-31',
    });
    expect(normalizeImportDate('12/31/2026')).toMatchObject({
      status: 'ok',
      ymd: '2026-12-31',
    });
  });

  it('preserves 4-digit year-only values (existing Date.parse behaviour)', () => {
    const n = normalizeImportDate('2026');
    expect(n.status).toBe('ok');
    if (n.status !== 'ok') return;
    expect(n.date.getUTCFullYear()).toBe(2026);
  });

  it('treats empty cells as empty, not a default date', () => {
    expect(normalizeImportDate('')).toEqual({ status: 'empty' });
    expect(normalizeImportDate(null)).toEqual({ status: 'empty' });
    expect(normalizeImportDate(undefined)).toEqual({ status: 'empty' });
    expect(normalizeImportDate('   ')).toEqual({ status: 'empty' });
  });

  it('rejects invalid strings', () => {
    expect(normalizeImportDate('not-a-date')).toMatchObject({
      status: 'invalid',
      original: 'not-a-date',
    });
    expect(normalizeImportDate('32/13/2026')).toMatchObject({
      status: 'invalid',
    });
  });

  it('rejects the expanded year that Prisma received (+046277-01-01)', () => {
    const n = normalizeImportDate('+046277-01-01T00:00:00.000Z');
    expect(n.status).toBe('invalid');
    expect(new Date('+046277-01-01T00:00:00.000Z').toISOString()).toBe(
      '+046277-01-01T00:00:00.000Z',
    );
  });

  it('does not treat new Date(serial) milliseconds as an invoice date', () => {
    expect(new Date(46277).toISOString()).toBe('1970-01-01T00:00:46.277Z');
    expect(normalizeImportDate(46277)).toMatchObject({
      iso: '2026-09-12T00:00:00.000Z',
    });
  });

  it('formats SheetJS date cells as ISO instead of the raw serial', () => {
    const cell = { t: 'n' as const, v: 46277, w: '2026-09-12' };
    expect(excelCellToImportString(cell)).toBe('2026-09-12T00:00:00.000Z');
    expect(excelCellToImportString({ t: 'n', v: 100.5, w: '100.5' })).toBe(
      '100.5',
    );
  });

  it('validateMappedRow accepts DD/MM and ISO issue dates', () => {
    const slash = validateMappedRow(2, baseRow('01/07/2026'));
    expect(slash.status).toBe('VALID');
    expect(slash.mapped?.dateTimeIssued).toBe('2026-07-01T00:00:00.000Z');

    const iso = validateMappedRow(2, baseRow('2026-07-01'));
    expect(iso.status).toBe('VALID');
    expect(iso.mapped?.dateTimeIssued).toBe('2026-07-01T00:00:00.000Z');

    const emptyOptional = validateMappedRow(2, {
      ...baseRow('2026-07-01'),
      serviceDeliveryDate: '',
      deliveryDateValidity: '',
    });
    expect(emptyOptional.status).toBe('VALID');
  });

  it('validateMappedRow accepts Excel serial issue dates and rejects garbage', () => {
    const ok = validateMappedRow(2, baseRow('46277'));
    expect(ok.status).toBe('VALID');
    expect(ok.mapped?.dateTimeIssued).toBe('2026-09-12T00:00:00.000Z');

    const bad = validateMappedRow(3, baseRow('not-a-date'));
    expect(bad.status).toBe('INVALID');
    expect(bad.errors[0]?.code).toBe('INVALID_DATE');
    expect(bad.errors[0]?.message).toContain('الصف 3');
    expect(bad.errors[0]?.message).toContain('تاريخ الإصدار');
    expect(bad.errors[0]?.message).toContain('not-a-date');

    const absurd = validateMappedRow(4, baseRow('+046277-01-01T00:00:00.000Z'));
    expect(absurd.status).toBe('INVALID');
    expect(absurd.errors[0]?.code).toBe('INVALID_DATE');
  });

  it('buildDocumentUpsert writes ISO dates so prisma.document.create never sees year 46277', () => {
    const group = groupRowsByInternalId([
      { rowNumber: 1, mapped: baseRow('46277') },
    ])[0]!;
    const dto = buildDocumentUpsert(group, {
      defaultBranchId: 'branch-1',
      jobDocumentType: 'I',
    });
    expect(dto.issueDateTime).toBe('2026-09-12T00:00:00.000Z');
    expect(new Date(dto.issueDateTime).getUTCFullYear()).toBe(2026);
  });

  it('buildDocumentUpsert throws a row/column error for invalid dates', () => {
    const group = groupRowsByInternalId([
      { rowNumber: 7, mapped: baseRow('not-a-date') },
    ])[0]!;
    expect(() =>
      buildDocumentUpsert(group, {
        defaultBranchId: 'branch-1',
        jobDocumentType: 'I',
      }),
    ).toThrow(/الصف 7/);
  });

  it('invalidImportDateMessage and Prisma error detector stay user-safe', () => {
    expect(invalidImportDateMessage(2, 'تاريخ الإصدار', '46277')).toContain(
      'الصف 2',
    );
    expect(
      isPrismaDateTimeError(
        new Error(
          'Invalid prisma.document.create() invocation:\nCould not convert argument value Object',
        ),
      ),
    ).toBe(true);
    expect(isPrismaDateTimeError(new Error('item code missing'))).toBe(false);
  });
});

describe('parseXlsxBuffer Excel date cells', () => {
  it('emits ISO for a real Excel date cell (serial 46277)', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Invoices');
    ws.addRow(['internalID', 'dateTimeIssued', 'quantity']);
    const row = ws.addRow(['INV-1', new Date(Date.UTC(2026, 8, 12)), 1]);
    row.getCell(2).numFmt = 'yyyy-mm-dd';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const raw = XLSX.read(buf, { type: 'buffer', cellDates: false });
    expect(raw.Sheets.Invoices!.B2).toMatchObject({ t: 'n', v: 46277 });

    const rows: Record<string, string>[] = [];
    await parseXlsxBuffer(buf, {
      onRow: (r) => {
        rows.push(r.cells);
      },
    });
    expect(rows[0]?.dateTimeIssued).toBe('2026-09-12T00:00:00.000Z');
    expect(rows[0]?.quantity).toBe('1');
  });
});
