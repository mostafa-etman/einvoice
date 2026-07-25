import {
  calculateDocumentTotals,
  calculateLine,
  type LineInput,
} from './calculate-totals.js';

describe('FX / foreign currency line fields', () => {
  it('keeps unit price decimal strings for non-EGP sold amounts', () => {
    const line: LineInput = {
      description: 'Import',
      itemType: 'EGS',
      itemCode: 'X',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
    };
    const computed = calculateLine(line);
    const totals = calculateDocumentTotals([computed], '0.00');
    expect(computed.salesTotal).toBe('100.00');
    expect(totals.totalAmount).toBe('114.00');
  });
});
