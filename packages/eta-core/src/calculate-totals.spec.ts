import { calculateDocumentTotals, calculateLine, type LineInput } from './calculate-totals.js';

describe('calculate totals', () => {
  it('computes line and document totals as 2-dp strings', () => {
    const linesIn: LineInput[] = [
      {
        description: 'A',
        itemType: 'EGS',
        itemCode: '1',
        unitType: 'EA',
        quantity: '2',
        unitPrice: '10.00',
        discountAmount: '1.00',
        taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
      },
    ];
    const lines = linesIn.map(calculateLine);
    expect(lines[0]!.salesTotal).toBe('20.00');
    expect(lines[0]!.discount).toBe('1.00');
    expect(lines[0]!.netTotal).toBe('19.00');
    expect(lines[0]!.taxAmounts[0]!.amount).toBe('2.66');
    expect(lines[0]!.total).toBe('21.66');

    const totals = calculateDocumentTotals(lines, '0.00');
    expect(totals.totalSalesAmount).toBe('20.00');
    expect(totals.netAmount).toBe('19.00');
    expect(totals.totalAmount).toBe('21.66');
  });
});
