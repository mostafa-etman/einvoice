import { buildInvoice } from './builders/document.js';
import type { JsonObject } from './canonical-serialize.js';
import { validateDocument } from './local-validator.js';

function validate(document: JsonObject) {
  return validateDocument({
    kind: 'INVOICE',
    document,
    typeVersionSchema: {
      documentType: 'I',
      documentTypeVersion: '1.0',
      requiredPaths: [],
    },
    refs: { branchOk: true, currencyOk: true, itemCodesOk: true },
    lines: [],
  });
}

const WITHHOLDING_LINE = {
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
};

describe('SF337 item-total check before submission', () => {
  const built = buildInvoice({
    documentTypeVersion: '1.0',
    dateTimeIssued: '2026-08-01T10:00:00Z',
    internalID: 'WHT-1',
    issuer: { name: 'Seller' },
    receiver: { name: 'Buyer' },
    lines: [WITHHOLDING_LINE],
  });

  it('passes a correctly signed withholding document', () => {
    expect(built.etaPayload.totalAmount).toBe(113);
    const issues = validate(built.etaPayload);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports expected vs actual when withholding was added instead of subtracted', () => {
    const document = JSON.parse(JSON.stringify(built.etaPayload)) as JsonObject;
    const lines = document.invoiceLines as JsonObject[];
    lines[0]!.total = 115;
    document.totalAmount = 115;

    const issues = validate(document);
    const itemTotal = issues.find((i) => i.code === 'ETA_ITEM_TOTAL_MISMATCH');
    expect(itemTotal).toMatchObject({
      severity: 'error',
      path: 'invoiceLines[0].total',
      params: {
        line: '1',
        expected: '113.00',
        actual: '115.00',
        difference: '2.00',
        additiveTaxes: '14.00',
        withholdingTaxes: '1.00',
      },
    });
    // totalAmount agrees with the corrupted lines, so only the line is flagged.
    expect(issues.some((i) => i.code === 'ETA_TOTAL_AMOUNT_MISMATCH')).toBe(false);
  });

  it('accepts rounding drift inside ETA tolerance of 0.5', () => {
    const document = JSON.parse(JSON.stringify(built.etaPayload)) as JsonObject;
    const lines = document.invoiceLines as JsonObject[];
    lines[0]!.total = 113.4;
    document.totalAmount = 113.4;
    expect(validate(document).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags a document total that ignores the extra discount', () => {
    const document = JSON.parse(JSON.stringify(built.etaPayload)) as JsonObject;
    document.extraDiscountAmount = 10;
    const issues = validate(document);
    expect(issues.find((i) => i.code === 'ETA_TOTAL_AMOUNT_MISMATCH')).toMatchObject({
      params: { expected: '103.00', actual: '113.00' },
    });
  });
});
