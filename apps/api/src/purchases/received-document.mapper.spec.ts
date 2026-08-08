import { extractReceivedLineTaxesRaw, mapDetailsLines } from './received-document.mapper';
import { normalizeLineTaxes } from '../documents/local-invoice-pdf';

describe('extractReceivedLineTaxesRaw', () => {
  it('reads lineTaxableItems when taxableItems is null and taxesJson is empty', () => {
    const raw = extractReceivedLineTaxesRaw({
      taxesJson: [],
      rawJson: {
        taxableItems: null,
        lineTaxableItems: [
          { taxType: 'T1', subType: 'V009', rate: 14, amount: 1792 },
        ],
      },
    });
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as unknown[]).length).toBe(1);
    const normalized = normalizeLineTaxes(raw);
    expect(normalized[0]).toMatchObject({
      taxType: 'T1',
      subType: 'V009',
      rate: '14',
      amount: '1792',
    });
  });

  it('mapDetailsLines stores lineTaxableItems into taxesJson', () => {
    const lines = mapDetailsLines({
      invoiceLines: [
        {
          description: 'Item',
          itemType: 'EGS',
          itemCode: 'X',
          unitType: 'EA',
          quantity: 1,
          unitValue: { amountEGP: 100 },
          taxableItems: null,
          lineTaxableItems: [
            { taxType: 'T1', subType: 'V001', rate: 14, amount: 14 },
          ],
        },
      ],
    });
    expect(Array.isArray(lines[0]!.taxesJson)).toBe(true);
    expect((lines[0]!.taxesJson as unknown[]).length).toBe(1);
  });
});
