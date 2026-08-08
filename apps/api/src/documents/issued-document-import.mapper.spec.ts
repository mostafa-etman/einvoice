import {
  etaDocumentTypeToKind,
  mapEtaIssuedDetailsToImport,
} from './issued-document-import.mapper';

describe('issued-document-import.mapper', () => {
  it('maps ETA type codes to DocumentKind', () => {
    expect(etaDocumentTypeToKind('I')).toBe('INVOICE');
    expect(etaDocumentTypeToKind('C')).toBe('CREDIT_NOTE');
    expect(etaDocumentTypeToKind('EI')).toBe('EXPORT_INVOICE');
  });

  it('maps details with taxableItems into import lines + totals', () => {
    const mapped = mapEtaIssuedDetailsToImport(
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        internalId: 'INV-HIST-1',
        documentType: 'I',
        status: 'Valid',
        dateTimeIssued: '2026-01-15T10:00:00Z',
        totalAmount: '16552.80',
        netAmount: '14520.00',
      },
      {
        uuid: '11111111-1111-1111-1111-111111111111',
        documentType: 'I',
        documentTypeVersion: '1.0',
        dateTimeIssued: '2026-01-15T10:00:00Z',
        issuer: { type: 'B', id: '123456789', name: 'Seller' },
        receiver: { type: 'B', id: '987654321', name: 'Buyer' },
        totalSalesAmount: '14520.00',
        totalDiscountAmount: '0',
        netAmount: '14520.00',
        totalAmount: '16552.80',
        taxTotals: [{ taxType: 'T1', amount: '2032.80' }],
        invoiceLines: [
          {
            description: 'Consulting',
            itemType: 'EGS',
            itemCode: 'EG-1',
            unitType: 'EA',
            quantity: '100',
            unitValue: { currencySold: 'EGP', amountEGP: 145.2 },
            salesTotal: '14520.00',
            netTotal: '14520.00',
            total: '16552.80',
            taxableItems: [
              { taxType: 'T1', subType: 'V001', rate: '14', amount: '2032.80' },
            ],
          },
        ],
      },
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.kind).toBe('INVOICE');
    expect(mapped!.status).toBe('VALID');
    expect(mapped!.etaUuid).toBe('11111111-1111-1111-1111-111111111111');
    expect(mapped!.lines).toHaveLength(1);
    expect(mapped!.lines[0]!.taxes[0]).toMatchObject({
      taxType: 'T1',
      subType: 'V001',
      rate: '14',
      amount: '2032.80',
    });
    expect(mapped!.totalAmount).toBe('16552.80');
  });
});
