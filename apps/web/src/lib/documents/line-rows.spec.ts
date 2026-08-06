import { calculateDocumentTotals, calculateLine, type LineInput } from '@einvoice/eta-core';

import { removeRowByKey, stripRowKey, withRowKey, withRowKeys } from './line-rows';

const line = (description: string, unitPrice: string, rate: string): LineInput => ({
  description,
  itemType: 'EGS',
  itemCode: 'EG-100',
  unitType: 'EA',
  quantity: '2',
  unitPrice,
  taxes: [{ taxType: 'T1', subType: 'V009', rate }],
});

const totalsOf = (lines: LineInput[]) =>
  calculateDocumentTotals(lines.map((l) => calculateLine(l)));

describe('invoice line rows', () => {
  it('gives every row a distinct key, including identical lines', () => {
    const rows = withRowKeys([line('same', '100.00', '14'), line('same', '100.00', '14')]);
    expect(rows[0]!.rowKey).not.toEqual(rows[1]!.rowKey);
  });

  it('removes the targeted row, not the one at the same index', () => {
    const rows = withRowKeys([
      line('first', '100.00', '14'),
      line('middle', '50.00', '14'),
      line('last', '25.00', '14'),
    ]);

    const next = removeRowByKey(rows, rows[1]!.rowKey);

    expect(next.map((r) => r.description)).toEqual(['first', 'last']);
    expect(next.map((r) => r.rowKey)).toEqual([rows[0]!.rowKey, rows[2]!.rowKey]);
  });

  it('drops the removed line tax rows from taxTotals and recomputes totals', () => {
    const rows = withRowKeys([
      line('first', '100.00', '14'),
      line('middle', '50.00', '14'),
      line('last', '25.00', '14'),
    ]);

    const before = totalsOf(rows.map(stripRowKey));
    expect(before.netAmount).toBe('350.00');
    expect(before.taxTotals).toEqual([{ taxType: 'T1', amount: '49.00' }]);

    const after = totalsOf(removeRowByKey(rows, rows[1]!.rowKey).map(stripRowKey));

    // 2 x 100 + 2 x 25 = 250, VAT 14% = 35.00 (the middle line's 14.00 is gone).
    expect(after.netAmount).toBe('250.00');
    expect(after.totalAmount).toBe('285.00');
    expect(after.taxTotals).toEqual([{ taxType: 'T1', amount: '35.00' }]);
  });

  it('supports removing every row so the form can show an empty state', () => {
    let rows = withRowKeys([line('only', '100.00', '14')]);
    rows = removeRowByKey(rows, rows[0]!.rowKey);
    expect(rows).toHaveLength(0);
  });

  it('strips the UI-only row key before the line is sent to the API', () => {
    const row = withRowKey(line('first', '100.00', '14'));
    expect(Object.keys(stripRowKey(row))).not.toContain('rowKey');
  });
});
