import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateDocumentTotals,
  calculateLine,
  estimateEtaItemTotal,
} from './calculate-totals.js';
import type { JsonObject } from './canonical-serialize.js';
import { etaTaxDirection } from './tax-modes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ETA_SAMPLE = join(
  __dirname,
  '../../../specs/005-document-building-serialization/golden-vectors/eta-sdk-one-doc.json',
);

describe('withholding tax (T4) reduces the total', () => {
  /**
   * The rejected document: SF337 "Total [115] must be [113], difference [2]".
   * The difference is twice the withholding amount — 1.00 added where it
   * should have been subtracted.
   */
  it('net=100, T1 +14.00, T4 -1.00 → item total 113.00, not 115.00', () => {
    const line = calculateLine({
      description: 'Service',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [
        { taxType: 'T1', subType: 'V009', rate: '14.00' },
        { taxType: 'T4', subType: 'W004', rate: '1.00' },
      ],
    });

    expect(line.netTotal).toBe('100.00');
    expect(line.taxAmounts).toEqual([
      { taxType: 'T1', subType: 'V009', rate: '14.00', amount: '14.00', direction: 'additive' },
      { taxType: 'T4', subType: 'W004', rate: '1.00', amount: '1.00', direction: 'deductible' },
    ]);
    expect(line.additiveTaxTotal).toBe('14.00');
    expect(line.deductibleTaxTotal).toBe('1.00');
    expect(line.total).toBe('113.00');
    // What the old all-taxes-are-additive engine produced, and ETA's difference.
    expect(Number(line.netTotal) + Number(line.additiveTaxTotal) + Number(line.deductibleTaxTotal)).toBe(115);
    expect(115 - Number(line.total)).toBe(2);

    const totals = calculateDocumentTotals([line]);
    expect(totals.netAmount).toBe('100.00');
    expect(totals.totalAmount).toBe('113.00');
    // taxableItems / taxTotals amounts stay positive; only the total is signed.
    expect(totals.taxTotals).toEqual([
      { taxType: 'T1', amount: '14.00' },
      { taxType: 'T4', amount: '1.00' },
    ]);
  });

  it('scales with the withholding rate: 2% withholding on net 100 → 112.00', () => {
    const line = calculateLine({
      description: 'Service',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [
        { taxType: 'T1', subType: 'V009', rate: '14.00' },
        { taxType: 'T4', subType: 'W004', rate: '2.00' },
      ],
    });
    expect(line.total).toBe('112.00');
  });

  it('charges T4 on netTotal minus the items discount', () => {
    const line = calculateLine({
      description: 'Service',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      itemsDiscount: '10.00',
      taxes: [{ taxType: 'T4', subType: 'W004', rate: '5.00' }],
    });
    expect(line.taxAmounts[0]!.amount).toBe('4.50');
    expect(line.total).toBe('85.50');
  });

  it('subtracts the extra discount from the document total only', () => {
    const line = calculateLine({
      description: 'Service',
      itemType: 'EGS',
      itemCode: '1',
      unitType: 'EA',
      quantity: '1',
      unitPrice: '100.00',
      taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
    });
    const totals = calculateDocumentTotals([line], '5.00');
    expect(totals.netAmount).toBe('100.00');
    expect(totals.totalDiscountAmount).toBe('0.00');
    expect(totals.totalAmount).toBe('109.00');
  });
});

/**
 * ETA's own published sample document exercises T1-T20 on both lines. Every
 * amount below comes from that file, so it pins the calculation to the
 * authority's numbers rather than ours.
 */
describe('ETA SDK sample document (T1-T20)', () => {
  const sample = JSON.parse(readFileSync(ETA_SAMPLE, 'utf8')) as JsonObject;
  const lines = sample.invoiceLines as Array<Record<string, number | JsonObject[]>>;

  it.each([0, 1])('line %i total matches ETA rule 17', (i) => {
    const line = lines[i]! as unknown as {
      netTotal: number;
      itemsDiscount: number;
      total: number;
      taxableItems: Array<{ taxType: string; amount: number }>;
    };
    const estimate = estimateEtaItemTotal({
      netTotal: line.netTotal,
      itemsDiscount: line.itemsDiscount,
      taxes: line.taxableItems,
    });
    expect(Number(estimate.total)).toBe(line.total);
  });

  it('reproduces every taxable-item amount from quantity, rates and fixed amounts', () => {
    const computed = calculateLine({
      description: 'Computer1',
      itemType: 'GPC',
      itemCode: '10001774',
      unitType: 'EA',
      quantity: '5',
      unitPrice: '189.40',
      discountAmount: '66.29',
      itemsDiscount: '5.00',
      valueDifference: '7.00',
      taxes: (
        lines[0]!.taxableItems as unknown as Array<{
          taxType: string;
          subType: string;
          rate: number;
          amount: number;
        }>
      ).map((t) => ({
        taxType: t.taxType,
        subType: t.subType,
        rate: String(t.rate),
        // T3 and T6 are fixed-amount types: ETA supplies the amount, rate is 0.
        ...(t.taxType === 'T3' || t.taxType === 'T6'
          ? { amount: String(t.amount) }
          : {}),
      })),
    });

    expect(computed.netTotal).toBe('880.71');
    expect(computed.totalTaxableFees).toBe('817.42');
    expect(
      computed.taxAmounts.map((t) => [t.taxType, Number(t.amount)]),
    ).toEqual(
      (
        lines[0]!.taxableItems as unknown as Array<{ taxType: string; amount: number }>
      ).map((t) => [t.taxType, t.amount]),
    );
    expect(computed.total).toBe('2969.89');
  });

  it('document totals match the published header amounts', () => {
    const computed = lines.map((l) => {
      const line = l as unknown as {
        salesTotal: number;
        netTotal: number;
        itemsDiscount: number;
        total: number;
        discount: { amount: number };
        taxableItems: Array<{ taxType: string; subType: string; rate: number; amount: number }>;
      };
      return {
        salesTotal: String(line.salesTotal),
        discount: String(line.discount.amount),
        netTotal: String(line.netTotal),
        itemsDiscount: String(line.itemsDiscount),
        valueDifference: '0.00',
        totalTaxableFees: '0.00',
        additiveTaxTotal: '0.00',
        deductibleTaxTotal: '0.00',
        total: String(line.total),
        taxAmounts: line.taxableItems.map((t) => ({
          taxType: t.taxType,
          subType: t.subType,
          rate: String(t.rate),
          amount: String(t.amount),
          direction: etaTaxDirection(t.taxType),
        })),
      };
    });

    const totals = calculateDocumentTotals(computed, String(sample.extraDiscountAmount));
    expect(Number(totals.totalSalesAmount)).toBe(sample.totalSalesAmount);
    expect(Number(totals.totalDiscountAmount)).toBe(sample.totalDiscountAmount);
    expect(Number(totals.netAmount)).toBe(sample.netAmount);
    expect(Number(totals.totalItemsDiscountAmount)).toBe(sample.totalItemsDiscountAmount);
    expect(Number(totals.totalAmount)).toBe(sample.totalAmount);
    expect(
      totals.taxTotals.map((t) => ({ taxType: t.taxType, amount: Number(t.amount) })),
    ).toEqual(sample.taxTotals);
  });
});
