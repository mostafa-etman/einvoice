import { calculateLine, estimateEtaItemTotal } from './calculate-totals.js';
import { isFixedAmountTaxType } from './tax-modes.js';
import { buildInvoice } from './builders/document.js';
import { validateDocument } from './local-validator.js';
import type { JsonObject } from './canonical-serialize.js';

describe('fixed-amount tax types (T3, T6)', () => {
  it('requires an explicit amount and locks rate at 0', () => {
    expect(isFixedAmountTaxType('T3')).toBe(true);
    expect(() =>
      calculateLine({
        description: 'A',
        itemType: 'EGS',
        itemCode: '1',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        taxes: [{ taxType: 'T3', subType: 'Tbl02', rate: '0' }],
      }),
    ).toThrow(/requires an explicit amount/);

    const line = calculateLine({
      description: 'A',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [
        { taxType: 'T1', subType: 'V009', rate: '14.00' },
        { taxType: 'T3', subType: 'Tbl02', rate: '0', amount: '5.00' },
        { taxType: 'T6', subType: 'ST02', rate: '0', amount: '3.00' },
        { taxType: 'T4', subType: 'W004', rate: '1.00' },
      ],
    });

    // VAT base includes T3; T6 is a taxable fee on net; T4 is withheld.
    expect(line.taxAmounts.find((t) => t.taxType === 'T3')!.amount).toBe('5.00');
    expect(line.taxAmounts.find((t) => t.taxType === 'T6')!.amount).toBe('3.00');
    expect(line.taxAmounts.find((t) => t.taxType === 'T1')!.amount).toBe('15.12');
    expect(line.taxAmounts.find((t) => t.taxType === 'T4')!.amount).toBe('1.00');
    // 100 + 15.12 + 5 + 3 - 1 = 122.12
    expect(line.total).toBe('122.12');
    expect(
      estimateEtaItemTotal({
        netTotal: line.netTotal,
        taxes: line.taxAmounts,
      }).total,
    ).toBe('122.12');
  });

  it('maps fixed amounts into the ETA payload and validates them', () => {
    const built = buildInvoice({
      documentTypeVersion: '1.0',
      dateTimeIssued: '2026-08-01T10:00:00Z',
      internalID: 'FIX-1',
      issuer: { name: 'Seller' },
      receiver: { name: 'Buyer' },
      lines: [
        {
          description: 'Service',
          itemType: 'EGS',
          itemCode: '1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [
            { taxType: 'T1', subType: 'V009', rate: '14.00' },
            { taxType: 'T3', subType: 'Tbl02', rate: '0', amount: '10.00' },
          ],
        },
      ],
    });

    const taxable = (
      (built.etaPayload.invoiceLines as JsonObject[])[0]!.taxableItems as Array<{
        taxType: string;
        amount: number;
        rate: number;
      }>
    );
    expect(taxable.find((t) => t.taxType === 'T3')).toMatchObject({
      amount: 10,
      rate: 0,
    });
    expect(built.etaPayload.totalAmount).toBe(125.4);

    const ok = validateDocument({
      kind: 'INVOICE',
      document: built.etaPayload,
      typeVersionSchema: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        requiredPaths: [],
      },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
      lines: [
        {
          description: 'Service',
          itemType: 'EGS',
          itemCode: '1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [
            { taxType: 'T1', subType: 'V009', rate: '14.00' },
            { taxType: 'T3', subType: 'Tbl02', rate: '0', amount: '10.00' },
          ],
        },
      ],
    });
    expect(ok.filter((i) => i.severity === 'error')).toEqual([]);

    const missing = validateDocument({
      kind: 'INVOICE',
      document: built.etaPayload,
      typeVersionSchema: {
        documentType: 'I',
        documentTypeVersion: '1.0',
        requiredPaths: [],
      },
      refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
      lines: [
        {
          description: 'Service',
          itemType: 'EGS',
          itemCode: '1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [{ taxType: 'T3', subType: 'Tbl02', rate: '5' }],
        },
      ],
    });
    expect(missing.some((i) => i.code === 'FIXED_TAX_AMOUNT_REQUIRED')).toBe(true);
    expect(missing.some((i) => i.code === 'FIXED_TAX_RATE_MUST_BE_ZERO')).toBe(true);
  });
});
