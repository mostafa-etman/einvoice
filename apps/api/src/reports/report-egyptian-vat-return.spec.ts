import { add, sub } from '@einvoice/eta-core';
import {
  VatReturnAccumulator,
  availableTaxTypes,
  parseVatReturnTaxLines,
  sumVatReturn,
  type VatReturnRow,
} from './report-egyptian-vat-return';
import { issuedDocumentSign, receivedDocumentSign } from './report-netting';

describe('egyptian VAT return aggregation', () => {
  it('nets credit notes and keeps T4 out of VAT net', () => {
    const acc = new VatReturnAccumulator();
    acc.addTaxes(
      'output',
      [{ taxType: 'T1', subType: 'V009', rate: '14', amount: '140' }],
      1,
      '1000',
    );
    acc.addTaxes(
      'output',
      [{ taxType: 'T1', subType: 'V009', rate: '14', amount: '14' }],
      -1,
      '100',
    );
    acc.addTaxes(
      'output',
      [{ taxType: 'T4', subType: 'W001', rate: '5', amount: '50' }],
      1,
      '1000',
    );
    acc.addTaxes(
      'input',
      [{ taxType: 'T1', subType: 'V009', rate: '14', amount: '70' }],
      1,
      '500',
    );

    const all = acc.rows();
    const outputVat = sumVatReturn(
      all,
      (r) => r.side === 'output' && r.category === 'vat',
    );
    const inputVat = sumVatReturn(
      all,
      (r) => r.side === 'input' && r.category === 'vat',
    );
    const withholding = sumVatReturn(
      all,
      (r) => r.category === 'withholding',
    );
    const netVat = sub(outputVat.taxAmount, inputVat.taxAmount);

    expect(outputVat.taxAmount).toBe('126.00'); // 140 - 14
    expect(inputVat.taxAmount).toBe('70.00');
    expect(netVat).toBe('56.00');
    expect(withholding.taxAmount).toBe('50.00');
    expect(availableTaxTypes(all)).toEqual(['T1', 'T4']);
  });

  it('filters by tax type', () => {
    const acc = new VatReturnAccumulator();
    acc.addTaxes(
      'output',
      [
        { taxType: 'T1', subType: 'V009', rate: '14', amount: '14' },
        { taxType: 'T2', subType: 'Tbl01', rate: '10', amount: '10' },
      ],
      1,
      '100',
    );
    const onlyT1 = acc.rows('T1');
    expect(onlyT1.every((r: VatReturnRow) => r.taxType === 'T1')).toBe(true);
  });

  it('uses credit/debit signs from netting helpers', () => {
    expect(issuedDocumentSign('CREDIT_NOTE')).toBe(-1);
    expect(issuedDocumentSign('DEBIT_NOTE')).toBe(1);
    expect(receivedDocumentSign('PURCHASE_RETURN')).toBe(-1);
    expect(receivedDocumentSign('PURCHASE_INVOICE')).toBe(1);
  });

  it('parses subtype from ETA-shaped JSON', () => {
    const lines = parseVatReturnTaxLines([
      { taxType: 'T1', subType: 'V009', rate: 14, amount: 14 },
    ]);
    expect(lines[0]?.subType).toBe('V009');
  });

  it('add is used for multi-band totals', () => {
    expect(add('1.00', '2.00')).toBe('3.00');
  });
});
