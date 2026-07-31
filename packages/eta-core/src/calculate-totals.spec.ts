import { calculateDocumentTotals, calculateLine, type LineInput } from './calculate-totals.js';
import { exemptTax, zeroRatedTax } from './tax-modes.js';

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
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
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

  it('tax-free line: empty taxableItems, totalAmount equals net', () => {
    const line = calculateLine({
      description: 'Free',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '50.00',
      taxes: [],
    });
    expect(line.taxAmounts).toEqual([]);
    expect(line.netTotal).toBe('50.00');
    expect(line.total).toBe('50.00');

    const totals = calculateDocumentTotals([line]);
    expect(totals.taxTotals).toEqual([]);
    expect(totals.totalAmount).toBe(totals.netAmount);
    expect(totals.totalAmount).toBe('50.00');
  });

  it('zero-rated and exempt lines contribute 0 tax but keep a taxableItems entry', () => {
    const zero = calculateLine({
      description: 'Export',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [zeroRatedTax('V001')],
    });
    expect(zero.taxAmounts).toHaveLength(1);
    expect(zero.taxAmounts[0]!.amount).toBe('0.00');
    expect(zero.taxAmounts[0]!.subType).toBe('V001');
    expect(zero.total).toBe('100.00');

    const exempt = calculateLine({
      description: 'Exempt',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [exemptTax('V003')],
    });
    expect(exempt.taxAmounts[0]!.subType).toBe('V003');
    expect(exempt.taxAmounts[0]!.amount).toBe('0.00');
  });

  it('rejects duplicate TaxType on the same line', () => {
    expect(() =>
      calculateLine({
        description: 'A',
        itemType: 'EGS',
        itemCode: '1',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '10.00',
        taxes: [
          { taxType: 'T1', subType: 'V009', rate: '14' },
          { taxType: 'T1', subType: 'V010', rate: '5' },
        ],
      }),
    ).toThrow(/Duplicate TaxType/);
  });

  it('aggregates taxTotals only from lines that have taxes', () => {
    const taxed = calculateLine({
      description: 'A',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
    });
    const free = calculateLine({
      description: 'B',
      itemType: 'EGS',
      itemCode: '2',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '50.00',
      taxes: [],
    });
    const totals = calculateDocumentTotals([taxed, free]);
    expect(totals.taxTotals).toEqual([{ taxType: 'T1', amount: '14.00' }]);
    expect(totals.netAmount).toBe('150.00');
    expect(totals.totalAmount).toBe('164.00');
  });
});
