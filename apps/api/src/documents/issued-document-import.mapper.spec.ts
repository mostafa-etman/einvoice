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

  it('maps Cancelled search status to CANCELLED (never defaults to VALID)', () => {
    const mapped = mapEtaIssuedDetailsToImport(
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        internalId: 'INV-CAN-1',
        documentType: 'I',
        status: 'Cancelled',
        dateTimeIssued: '2026-01-15T10:00:00Z',
        netAmount: '100.00',
        totalAmount: '114.00',
      },
      {
        uuid: '22222222-2222-2222-2222-222222222222',
        documentType: 'I',
        invoiceLines: [],
      },
    );
    expect(mapped?.status).toBe('CANCELLED');
  });

  /**
   * Sample: INV-2026-0906-001 (uuid 7f3a1c2e-…) — VALID on ETA yesterday,
   * VAT 14% on 1000 net. ETA Get Document Details envelope + nested document
   * with taxableItems: null and taxes in lineTaxableItems (same shape as the
   * purchases sync bug).
   */
  const SAMPLE_UUID = '7f3a1c2e-9b4d-4e21-8a6c-1d5e9f0b2c3a';
  const sampleSearchRow = {
    uuid: SAMPLE_UUID,
    internalId: 'INV-2026-0906-001',
    documentType: 'I',
    status: 'Valid',
    dateTimeIssued: '2026-09-06T14:30:00Z',
    total: 1140,
    netAmount: 1000,
    receiverName: 'Buyer Co',
    receiverId: '987654321',
  };
  const sampleInnerInvoice = {
    uuid: SAMPLE_UUID,
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: '2026-09-06T14:30:00Z',
    status: 'DRAFT',
    issuer: { type: 'B', id: '123456789', name: 'Seller' },
    receiver: { type: 'B', id: '987654321', name: 'Buyer Co' },
    invoiceLines: [
      {
        description: 'Consulting',
        itemType: 'EGS',
        itemCode: 'EG-1',
        unitType: 'EA',
        quantity: '1',
        unitValue: { currencySold: 'EGP', amountEGP: 1000 },
        salesTotal: 1000,
        netTotal: 1000,
        total: 1140,
        taxableItems: null,
        lineTaxableItems: [
          { taxType: 'T1', subType: 'V009', rate: 14, amount: 140 },
        ],
      },
    ],
    taxTotals: [{ taxType: 'T1', subType: 'V009', rate: 14, amount: 140 }],
    totalSalesAmount: 1000,
    netAmount: 1000,
    totalAmount: 1140,
  };
  const sampleDetailsEnvelope = {
    uuid: SAMPLE_UUID,
    internalId: 'INV-2026-0906-001',
    status: 'Valid',
    dateTimeIssued: '2026-09-06T14:30:00Z',
    totalSales: 1000,
    netAmount: 1000,
    total: 1140,
    document: JSON.stringify(sampleInnerInvoice),
  };

  it('reads VALID from the ETA envelope, ignoring inner payload status DRAFT', () => {
    const mapped = mapEtaIssuedDetailsToImport(
      sampleSearchRow,
      sampleDetailsEnvelope,
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.status).toBe('VALID');
    expect(mapped!.etaStatus).toBe('Valid');
    expect(mapped!.status).not.toBe('DRAFT');
  });

  it('unwraps nested document and stores lineTaxableItems as line taxes + tax totals', () => {
    const mapped = mapEtaIssuedDetailsToImport(
      sampleSearchRow,
      sampleDetailsEnvelope,
    );
    expect(mapped!.lines).toHaveLength(1);
    expect(mapped!.lines[0]!.taxes[0]).toMatchObject({
      taxType: 'T1',
      subType: 'V009',
      rate: '14',
      amount: '140.00',
    });
    expect(mapped!.taxTotalsJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taxType: 'T1', amount: '140.00' }),
      ]),
    );
  });

  it('reads lineTaxableItems when taxableItems is an empty array (ETA details shape)', () => {
    const mapped = mapEtaIssuedDetailsToImport(sampleSearchRow, {
      uuid: SAMPLE_UUID,
      status: 'Valid',
      dateTimeIssued: '2026-09-06T14:30:00Z',
      invoiceLines: [
        {
          description: 'Item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: 1,
          unitValue: { amountEGP: 1000 },
          taxableItems: [],
          lineTaxableItems: [
            { taxType: 'T1', subType: 'V009', rate: 14, amount: 140 },
          ],
        },
      ],
    });
    expect(mapped!.status).toBe('VALID');
    expect(mapped!.lines[0]!.taxes).toHaveLength(1);
    expect(mapped!.lines[0]!.taxes[0]!.amount).toBe('140.00');
  });
});
