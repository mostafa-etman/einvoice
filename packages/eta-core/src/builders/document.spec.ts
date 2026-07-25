import { buildCreditNote, buildInvoice } from './document.js';

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
          taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
        },
      ],
    });
    expect(etaPayload.documentType).toBe('I');
    expect(Array.isArray(etaPayload.invoiceLines)).toBe(true);
    expect(totals.totalSalesAmount).toBe('10.00');
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
