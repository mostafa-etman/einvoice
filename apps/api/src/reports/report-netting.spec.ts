import { add, sub } from '@einvoice/eta-core';
import {
  issuedDocumentSign,
  receivedDocumentSign,
} from './report-netting';
import {
  accumulateTaxRows,
  signedTaxAmount,
  splitVatBreakdown,
  taxCategory,
} from './report-vat';

describe('report netting signs', () => {
  it('nets invoices − credits + debits', () => {
    const parts = [
      { kind: 'INVOICE', amount: '1000.00' },
      { kind: 'CREDIT_NOTE', amount: '200.00' },
      { kind: 'DEBIT_NOTE', amount: '50.00' },
      { kind: 'EXPORT_CREDIT_NOTE', amount: '10.00' },
    ];
    let net = '0.00';
    for (const p of parts) {
      const sign = issuedDocumentSign(p.kind);
      net = add(net, signedTaxAmount(p.amount, sign));
    }
    expect(net).toBe('840.00');
  });

  it('nets purchase returns as credits', () => {
    expect(receivedDocumentSign('PURCHASE_INVOICE')).toBe(1);
    expect(receivedDocumentSign('PURCHASE_RETURN')).toBe(-1);
    expect(receivedDocumentSign('OTHER_RECEIVED', 'C')).toBe(-1);
    expect(receivedDocumentSign('OTHER_RECEIVED', 'D')).toBe(1);
  });
});

describe('report VAT vs withholding', () => {
  it('keeps T1 in vat and T4 in withholding', () => {
    const rows = new Map();
    accumulateTaxRows(
      rows,
      [
        { taxType: 'T1', rate: '14', amount: '140.00' },
        { taxType: 'T4', rate: '1', amount: '10.00' },
      ],
      1,
    );
    accumulateTaxRows(
      rows,
      [{ taxType: 'T1', rate: '14', amount: '14.00' }],
      -1,
    );
    const split = splitVatBreakdown(rows.values());
    expect(split.vatTotal).toBe('126.00');
    expect(split.withholdingTotal).toBe('10.00');
    expect(taxCategory('T1')).toBe('vat');
    expect(taxCategory('T4')).toBe('withholding');
    expect(sub(split.vatTotal, '20.00')).toBe('106.00');
  });
});
