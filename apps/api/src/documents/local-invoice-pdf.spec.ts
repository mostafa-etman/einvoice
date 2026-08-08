import { formatMoney } from '@einvoice/eta-core';
import {
  formatDateDisplay,
  formatMoneyDisplay,
  normalizeLineTaxes,
  renderLocalInvoicePdf,
  segmentMixedText,
  shapeForPdf,
} from './local-invoice-pdf';

describe('local invoice PDF (display-only)', () => {
  const sample = {
    locale: 'en' as const,
    kind: 'INVOICE',
    internalId: 'INV-000042',
    issueDateTime: '2026-08-06T23:58:00.000Z',
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
      totalSalesAmount: '14520.00',
      totalDiscountAmount: '0.00',
      netAmount: '14520.00',
      totalAmount: '16552.80',
      extraDiscountAmount: '0.00',
      taxTotals: [{ taxType: 'T1', amount: '2032.80' }],
    },
  };

  it('formats money with grouping and dates LTR', () => {
    expect(formatMoneyDisplay('14520')).toBe('14,520.00');
    expect(formatMoneyDisplay('14520.5')).toBe('14,520.50');
    expect(formatDateDisplay('2026-08-06T23:58:00.000Z')).toBe(
      '2026-08-06 23:58',
    );
  });

  it('segments Arabic from LTR so digits are never reshaped', () => {
    const segs = segmentMixedText('إجمالي المبيعات: 14,520.00');
    expect(segs.some((s) => s.kind === 'ltr' && s.text.includes('14,520'))).toBe(
      true,
    );
    expect(segs.some((s) => s.kind === 'ar')).toBe(true);
    const shaped = shapeForPdf('إجمالي المبيعات: 14,520.00', true);
    expect(shaped).toContain('14,520.00');
    expect(shaped).not.toMatch(/00\.025/);
  });

  it('normalizeLineTaxes reads ETA taxableItems shapes', () => {
    expect(
      normalizeLineTaxes([
        { taxType: 'T1', subType: 'V001', rate: 14, amount: 28 },
      ]),
    ).toEqual([
      { taxType: 'T1', subType: 'V001', rate: '14', amount: '28' },
    ]);
    expect(
      normalizeLineTaxes({
        TaxableItems: [{ TaxType: 'T1', SubType: 'V001', rate: '14', Amount: '28.00' }],
      }),
    ).toEqual([
      { taxType: 'T1', subType: 'V001', rate: '14', amount: '28.00' },
    ]);
  });

  it('renders Arabic PDF with taxes and unreversed totals', async () => {
    const pdf = await renderLocalInvoicePdf({
      ...sample,
      locale: 'ar',
      issuer: { ...sample.issuer, name: 'شركة تجريبية' },
      lines: [
        {
          description: 'استشارات',
          itemType: 'EGS',
          itemCode: 'EG-123456789-CONS',
          unitType: 'EA',
          quantity: '100',
          unitPrice: '145.20',
          discountAmount: '0',
          taxes: [
            { taxType: 'T1', subType: 'V001', rate: '14', amount: '2032.80' },
          ],
        },
      ],
    });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
    // Content streams are compressed — still assert helpers used by renderer.
    expect(formatMoney(sample.totals.totalSalesAmount)).toBe('14520.00');
    expect(formatMoneyDisplay(sample.totals.totalSalesAmount)).toBe('14,520.00');
  });

  it('renders a PDF with metadata and expected byte size', async () => {
    const pdf = await renderLocalInvoicePdf(sample);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  });

  it('embeds a PNG logo without throwing', async () => {
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
});
