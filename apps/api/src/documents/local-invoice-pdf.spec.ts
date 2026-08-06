import { formatMoney } from '@einvoice/eta-core';
import { renderLocalInvoicePdf, shapeForPdf } from './local-invoice-pdf';

describe('local invoice PDF (display-only)', () => {
  const sample = {
    locale: 'en' as const,
    kind: 'INVOICE',
    internalId: 'INV-000042',
    issueDateTime: '2026-08-01T12:00:00Z',
    currencyCode: 'EGP',
    taxpayerActivityCode: '6201',
    issuer: {
      type: 'B',
      id: '123456789',
      name: 'Acme Trading',
      address: {
        country: 'EG',
        governate: 'Cairo',
        regionCity: 'Nasr City',
        street: 'Abbas El Akkad',
        buildingNumber: '12',
      },
    },
    receiver: {
      type: 'B',
      id: '987654321',
      name: 'Buyer Co',
    },
    lines: [
      {
        description: 'Consulting',
        itemType: 'EGS',
        itemCode: 'EG-123456789-CONS',
        unitType: 'EA',
        quantity: '2',
        unitPrice: '100.00',
        discountAmount: '0.00',
        taxes: [{ taxType: 'T1', subType: 'V001', rate: '14', amount: '28.00' }],
      },
    ],
    totals: {
      totalSalesAmount: '200.00',
      totalDiscountAmount: '0.00',
      netAmount: '200.00',
      totalAmount: '228.00',
      extraDiscountAmount: '0.00',
      taxTotals: [{ taxType: 'T1', amount: '28.00' }],
    },
  };

  it('renders a PDF with metadata and expected byte size (content is Flate-compressed)', async () => {
    const pdf = await renderLocalInvoicePdf(sample);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Title is stored uncompressed in the Info dict (UTF-16BE with BOM in PDFKit).
    expect(pdf.includes(Buffer.from('INV-000042', 'utf16le')) || pdf.toString('latin1').includes('INV-000042')).toBe(
      true,
    );
    expect(pdf.byteLength).toBeGreaterThan(5_000);
    // Totals use the shared money helper — keep the contract locked here.
    expect(formatMoney(sample.totals.totalAmount)).toBe('228.00');
  });

  it('renders without a logo and in Arabic locale', async () => {
    const pdf = await renderLocalInvoicePdf({
      ...sample,
      locale: 'ar',
      logo: null,
      issuer: { ...sample.issuer, name: 'شركة تجريبية' },
    });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it('embeds a PNG logo without throwing', async () => {
    // 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const pdf = await renderLocalInvoicePdf({
      ...sample,
      logo: { buffer: png, contentType: 'image/png' },
    });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('shapes Arabic text for visual order', () => {
    const shaped = shapeForPdf('مرحبا', true);
    expect(shaped.length).toBeGreaterThan(0);
    expect(shaped).not.toBe('مرحبا');
  });
});
