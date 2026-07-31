import { buildCreditNote, buildInvoice } from './document.js';
import { exemptTax, zeroRatedTax } from '../tax-modes.js';

describe('builders', () => {
  it('buildInvoice produces ordered payload with I type', () => {
    const { etaPayload, totals } = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-01-01T00:00:00Z',
      internalID: 'INV-1',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer', type: 'B' },
      lines: [
        {
          description: 'Item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
          taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
        },
      ],
    });
    expect(etaPayload.documentType).toBe('I');
    expect(Array.isArray(etaPayload.invoiceLines)).toBe(true);
    expect(totals.totalSalesAmount).toBe('10.00');
    // ETA schema requires JSON numbers (not decimal strings).
    expect(etaPayload.totalSalesAmount).toBe(10);
    expect(etaPayload.dateTimeIssued).toBe('2026-01-01T00:00:00Z');
    const line0 = (etaPayload.invoiceLines as { salesTotal: number }[])[0]!;
    expect(line0.salesTotal).toBe(10);
  });

  it('strips milliseconds from dateTimeIssued', () => {
    const { etaPayload } = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-07-31T09:16:00.000Z',
      internalID: 'INV-2',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer', type: 'B' },
      lines: [
        {
          description: 'Item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
        },
      ],
    });
    expect(etaPayload.dateTimeIssued).toBe('2026-07-31T09:16:00Z');
  });

  it('builds tax-free invoice with empty taxableItems and totalAmount = net', () => {
    const { etaPayload, totals } = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-01-01T00:00:00Z',
      internalID: 'INV-FREE',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer', type: 'B' },
      lines: [
        {
          description: 'No tax item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '2',
          unitPrice: '25.00',
          taxes: [],
        },
      ],
    });
    const line = (etaPayload.invoiceLines as Array<Record<string, unknown>>)[0]!;
    expect(line.taxableItems).toEqual([]);
    expect(etaPayload.taxTotals).toEqual([]);
    expect(etaPayload.totalAmount).toBe(etaPayload.netAmount);
    expect(etaPayload.totalAmount).toBe(50);
    expect(totals.taxTotals).toEqual([]);
  });

  it('zero-rated and exempt emit a T1 entry at rate 0 (not empty taxableItems)', () => {
    const zero = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-01-01T00:00:00Z',
      internalID: 'INV-ZERO',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer', type: 'B' },
      lines: [
        {
          description: 'Export',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [zeroRatedTax('V001')],
        },
      ],
    });
    const zLine = (zero.etaPayload.invoiceLines as Array<{
      taxableItems: Array<{ taxType: string; subType: string; rate: number; amount: number }>;
    }>)[0]!;
    expect(zLine.taxableItems).toEqual([
      { taxType: 'T1', amount: 0, subType: 'V001', rate: 0 },
    ]);

    const exempt = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-01-01T00:00:00Z',
      internalID: 'INV-EX',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer', type: 'B' },
      lines: [
        {
          description: 'Exempt',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [exemptTax('V003')],
        },
      ],
    });
    const eLine = (exempt.etaPayload.invoiceLines as Array<{
      taxableItems: Array<{ subType: string; rate: number }>;
    }>)[0]!;
    expect(eLine.taxableItems[0]!.subType).toBe('V003');
    expect(eLine.taxableItems[0]!.rate).toBe(0);
  });

  it('credit note builder sets type C', () => {
    const { etaPayload } = buildCreditNote({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-01-01T00:00:00Z',
      internalID: 'CN-1',
      issuer: { name: 'Issuer' },
      receiver: { name: 'Buyer' },
      references: { internalID: 'INV-1' },
      lines: [
        {
          description: 'Item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
        },
      ],
    });
    expect(etaPayload.documentType).toBe('C');
    expect(etaPayload.references).toBeTruthy();
  });
});
