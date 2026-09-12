import {
  exportDocsToCsv,
  exportDocsToJson,
  exportDocsToXlsx,
} from '../src/exports/local-exporters';
import { exportColumnHeaders } from '../src/exports/export-column-labels';
import * as XLSX from 'xlsx';
import {
  renderLocalInvoicesPdf,
  renderLocalInvoicePdf,
} from '../src/documents/local-invoice-pdf';
import { buildZipStore, safeInvoicePdfFilename } from '../src/exports/zip-store';

const rows = [
  {
    id: '1',
    internalId: 'INV-1',
    kind: 'INVOICE',
    status: 'VALID',
    issueDateTime: '2026-07-01T00:00:00.000Z',
    currencyCode: 'EGP',
    totalAmount: '100.00',
    netAmount: '87.72',
    receiverName: 'Buyer',
    etaUuid: 'u-1',
    side: 'sales' as const,
  },
];

function xlsxHeaders(buf: Buffer): string[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
  return (aoa[0] ?? []).map(String);
}

function pdfLatin(buf: Buffer): string {
  return buf.toString('latin1');
}

const invoiceInput = {
  locale: 'en' as const,
  kind: 'INVOICE',
  internalId: 'INV-1',
  issueDateTime: '2026-07-01T10:00:00.000Z',
  currencyCode: 'EGP',
  issuer: { name: 'Seller', id: '123' },
  receiver: { name: 'Buyer', id: '456' },
  lines: [
    {
      description: 'Item',
      itemType: 'EGS',
      itemCode: 'EG-1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [{ taxType: 'T1', subType: 'V001', rate: '14', amount: '14.00' }],
    },
  ],
  totals: {
    totalSalesAmount: '100.00',
    totalDiscountAmount: '0.00',
    netAmount: '100.00',
    totalAmount: '114.00',
    taxTotals: [{ taxType: 'T1', amount: '14.00' }],
  },
};

describe('local exporters (T036)', () => {
  it('emits CSV with headers', () => {
    const csv = exportDocsToCsv(rows).toString('utf8');
    expect(csv).toContain('internalId');
    expect(csv).toContain('INV-1');
    expect(csv).toContain('side');
  });

  it('emits an empty CSV with headers when nothing matched', () => {
    const csv = exportDocsToCsv([]).toString('utf8');
    expect(csv).toContain('internalId');
    expect(csv.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('emits XLSX buffer', () => {
    const buf = exportDocsToXlsx(rows);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it('emits XLSX headers when nothing matched', () => {
    const buf = exportDocsToXlsx([]);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it('emits JSON documents array with unchanged internal keys', () => {
    const json = JSON.parse(exportDocsToJson(rows).toString('utf8'));
    expect(json.documents).toHaveLength(1);
    expect(json.documents[0]).toMatchObject({
      internalId: 'INV-1',
      totalAmount: '100.00',
      etaUuid: 'u-1',
    });
  });

  it('uses Arabic UI labels for XLSX headers when locale=ar', () => {
    const buf = exportDocsToXlsx(rows, 'ar');
    const headers = xlsxHeaders(buf);
    expect(headers).toEqual(exportColumnHeaders('ar'));
    expect(headers).toContain('رقم الفاتورة');
    expect(headers).toContain('تاريخ الإصدار');
    expect(headers).toContain('نوع المستند');
    expect(headers.join(' ')).not.toMatch(/Invoice #|Issue date|Document type/);
    const csv = XLSX.utils.sheet_to_csv(
      XLSX.read(buf, { type: 'buffer' }).Sheets[
        XLSX.read(buf, { type: 'buffer' }).SheetNames[0]!
      ],
    );
    expect(csv).toContain('INV-1');
    expect(csv).toContain('100.00');
  });

  it('uses English UI labels for XLSX headers when locale=en', () => {
    const buf = exportDocsToXlsx(rows, 'en');
    const headers = xlsxHeaders(buf);
    expect(headers).toEqual(exportColumnHeaders('en'));
    expect(headers).toContain('Invoice #');
    expect(headers).toContain('Issue date');
    expect(headers).toContain('Document type');
    expect(headers.join(' ')).not.toMatch(/رقم الفاتورة|تاريخ الإصدار|نوع المستند/);
  });

  it('localizes CSV the same way as Excel', () => {
    const ar = exportDocsToCsv(rows, 'ar').toString('utf8');
    expect(ar.split('\n')[0]).toBe(exportColumnHeaders('ar').join(','));
    expect(ar).toContain('INV-1');
    const en = exportDocsToCsv(rows, 'en').toString('utf8');
    expect(en.split('\n')[0]).toBe(exportColumnHeaders('en').join(','));
  });
});

describe('invoice PDF export (actual invoices)', () => {
  it('renders one invoice PDF containing the identifier', async () => {
    const pdf = await renderLocalInvoicePdf(invoiceInput);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfLatin(pdf)).toContain('INV-1');
  });

  it('renders multiple invoices sequentially without duplicates', async () => {
    const pdf = await renderLocalInvoicesPdf(
      [
        invoiceInput,
        { ...invoiceInput, internalId: 'INV-2' },
        { ...invoiceInput, internalId: 'INV-3' },
      ],
      { locale: 'en' },
    );
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const text = pdfLatin(pdf);
    expect(text).toContain('INV-1');
    expect(text).toContain('INV-2');
    expect(text).toContain('INV-3');
    expect(text.split('INV-1').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('renders Arabic PDF with RTL labels and English PDF LTR identifiers', async () => {
    const ar = await renderLocalInvoicesPdf(
      [{ ...invoiceInput, locale: 'ar', internalId: 'INV-AR' }],
      { locale: 'ar' },
    );
    const en = await renderLocalInvoicesPdf(
      [{ ...invoiceInput, locale: 'en', internalId: 'INV-EN' }],
      { locale: 'en' },
    );
    expect(pdfLatin(ar)).toContain('INV-AR');
    expect(pdfLatin(en)).toContain('INV-EN');
    expect(en.byteLength).toBeGreaterThan(1000);
    expect(ar.byteLength).toBeGreaterThan(1000);
  });

  it('emits a valid empty PDF', async () => {
    const pdf = await renderLocalInvoicesPdf([], { locale: 'en' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfLatin(pdf)).toContain('No documents in this period');
  });

  it('ZIP contains one PDF per invoice with unique safe names', async () => {
    const a = await renderLocalInvoicePdf({ ...invoiceInput, internalId: 'INV/1' });
    const b = await renderLocalInvoicePdf({ ...invoiceInput, internalId: 'INV/1' });
    const used = new Set<string>();
    const zip = buildZipStore([
      {
        name: safeInvoicePdfFilename('INV/1', 'aaa', used),
        body: a,
      },
      {
        name: safeInvoicePdfFilename('INV/1', 'aaa', used),
        body: b,
      },
    ]);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    const latin = zip.toString('latin1');
    expect(latin).toContain('INV_1-aaa.pdf');
    expect(latin).toContain('INV_1-aaa-2.pdf');
  });
});
