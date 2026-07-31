import {
  exportDocsToCsv,
  exportDocsToJson,
  exportDocsToPdfInventory,
  exportDocsToXlsx,
} from '../src/exports/local-exporters';

describe('local exporters (T036)', () => {
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
    },
  ];

  it('emits CSV with headers', () => {
    const csv = exportDocsToCsv(rows).toString('utf8');
    expect(csv).toContain('internalId');
    expect(csv).toContain('INV-1');
  });

  it('emits XLSX buffer', () => {
    const buf = exportDocsToXlsx(rows);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it('emits JSON documents array', () => {
    const json = JSON.parse(exportDocsToJson(rows).toString('utf8'));
    expect(json.documents).toHaveLength(1);
  });

  it('emits PDF inventory', () => {
    const pdf = exportDocsToPdfInventory(rows);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.inventory.included).toEqual(['INV-1']);
  });
});
