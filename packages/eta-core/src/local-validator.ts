import type { JsonObject } from './canonical-serialize.js';
import {
  calculateLine,
  estimateEtaItemTotal,
  type EtaTaxAmountLike,
  type LineInput,
} from './calculate-totals.js';
import { KIND_TO_ETA_TYPE, type DocumentKind } from './builders/document.js';
import { isValidEtaDateTimeIssued } from './eta-formats.js';
import { add, formatMoney, sub } from './money.js';
import {
  documentKindTypicallyRequiresTax,
  findDuplicateTaxTypes,
  isFixedAmountTaxType,
  isFullyTaxFree,
} from './tax-modes.js';

export type ValidationIssue = {
  code: string;
  path: string;
  severity: 'error' | 'warning';
  messageKey: string;
  params?: Record<string, string>;
};

export type TypeVersionSchema = {
  documentType: string;
  documentTypeVersion: string;
  requiredPaths?: string[];
};

export type ValidatorRefs = {
  branchOk: boolean;
  currencyOk: boolean;
  itemCodesOk: boolean;
  originalDocumentOk?: boolean;
  exchangeRateOk?: boolean;
};

function hasPath(obj: JsonObject, path: string): boolean {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return false;
    cur = (cur as JsonObject)[p];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

const DECIMAL_DOC_PATHS = [
  'totalSalesAmount',
  'totalDiscountAmount',
  'netAmount',
  'totalAmount',
  'extraDiscountAmount',
  'totalItemsDiscountAmount',
] as const;

function assertJsonNumber(
  issues: ValidationIssue[],
  path: string,
  value: unknown,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({
      code: 'ETA_NUMBER_EXPECTED',
      path,
      severity: 'error',
      messageKey: 'documents.validation.numberExpected',
      params: { path, got: typeof value },
    });
  }
}

/** ETA applies a ±0.5 tolerance to every calculated amount (Main Calculations). */
export const ETA_TOTAL_TOLERANCE = 0.5;

function toAmount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return formatMoney(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return formatMoney(value);
  }
  return null;
}

/** Signed difference (actual - expected) when it breaches ETA's tolerance. */
function beyondTolerance(expected: string, actual: string): string | null {
  const difference = sub(actual, expected);
  return Math.abs(Number(difference)) > ETA_TOTAL_TOLERANCE ? difference : null;
}

/**
 * Mirrors ETA's SF337 item-total estimation before submission, so a wrong
 * total is reported locally with expected vs actual instead of coming back as
 * a refusal ("Total [115] must be [113], difference [2]").
 */
function checkEtaTotals(document: JsonObject, issues: ValidationIssue[]): void {
  const invoiceLines = document.invoiceLines;
  if (!Array.isArray(invoiceLines)) return;

  let sumLineTotals = '0.00';
  let sumNetTotals = '0.00';
  let incomplete = false;

  invoiceLines.forEach((line, i) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      incomplete = true;
      return;
    }
    const L = line as JsonObject;
    const netTotal = toAmount(L.netTotal);
    const declared = toAmount(L.total);
    if (netTotal == null || declared == null) {
      incomplete = true;
      return;
    }

    const taxes: EtaTaxAmountLike[] = [];
    for (const t of Array.isArray(L.taxableItems) ? L.taxableItems : []) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        incomplete = true;
        continue;
      }
      const item = t as JsonObject;
      const amount = toAmount(item.amount);
      if (amount == null) {
        incomplete = true;
        continue;
      }
      taxes.push({ taxType: String(item.taxType ?? ''), amount });
    }

    const estimate = estimateEtaItemTotal({
      netTotal,
      itemsDiscount: toAmount(L.itemsDiscount) ?? '0.00',
      taxes,
    });
    const difference = beyondTolerance(estimate.total, declared);
    if (difference) {
      issues.push({
        code: 'ETA_ITEM_TOTAL_MISMATCH',
        path: `invoiceLines[${i}].total`,
        severity: 'error',
        messageKey: 'documents.validation.itemTotalMismatch',
        params: {
          line: String(i + 1),
          expected: estimate.total,
          actual: declared,
          difference,
          netTotal: estimate.netTotal,
          additiveTaxes: estimate.additiveTaxTotal,
          withholdingTaxes: estimate.deductibleTaxTotal,
          itemsDiscount: estimate.itemsDiscount,
        },
      });
    }

    sumLineTotals = add(sumLineTotals, declared);
    sumNetTotals = add(sumNetTotals, netTotal);
  });

  if (incomplete) return;

  const netAmount = toAmount(document.netAmount);
  if (netAmount != null) {
    const difference = beyondTolerance(sumNetTotals, netAmount);
    if (difference) {
      issues.push({
        code: 'ETA_NET_AMOUNT_MISMATCH',
        path: 'netAmount',
        severity: 'error',
        messageKey: 'documents.validation.netAmountMismatch',
        params: { expected: sumNetTotals, actual: netAmount, difference },
      });
    }
  }

  const totalAmount = toAmount(document.totalAmount);
  if (totalAmount != null) {
    const extraDiscount = toAmount(document.extraDiscountAmount) ?? '0.00';
    const expected = sub(sumLineTotals, extraDiscount);
    const difference = beyondTolerance(expected, totalAmount);
    if (difference) {
      issues.push({
        code: 'ETA_TOTAL_AMOUNT_MISMATCH',
        path: 'totalAmount',
        severity: 'error',
        messageKey: 'documents.validation.totalAmountMismatch',
        params: {
          expected,
          actual: totalAmount,
          difference,
          lineTotals: sumLineTotals,
          extraDiscountAmount: extraDiscount,
        },
      });
    }
  }
}

export function validateDocument(params: {
  kind: DocumentKind;
  document: JsonObject;
  typeVersionSchema: TypeVersionSchema;
  refs: ValidatorRefs;
  lines?: LineInput[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { document, typeVersionSchema, refs, kind, lines } = params;

  const expectedType = KIND_TO_ETA_TYPE[kind];
  if (document.documentType !== expectedType) {
    issues.push({
      code: 'DOC_TYPE_MISMATCH',
      path: 'documentType',
      severity: 'error',
      messageKey: 'documents.validation.typeMismatch',
    });
  }

  if (typeVersionSchema.documentTypeVersion && document.documentTypeVersion) {
    if (document.documentTypeVersion !== typeVersionSchema.documentTypeVersion) {
      issues.push({
        code: 'DOC_VERSION_MISMATCH',
        path: 'documentTypeVersion',
        severity: 'error',
        messageKey: 'documents.validation.versionMismatch',
      });
    }
  }

  for (const path of typeVersionSchema.requiredPaths ?? [
    'issuer',
    'receiver',
    'invoiceLines',
    'internalID',
  ]) {
    if (!hasPath(document, path)) {
      issues.push({
        code: 'REQUIRED_FIELD',
        path,
        severity: 'error',
        messageKey: 'documents.validation.required',
        params: { path },
      });
    }
  }

  // ETA dateTimeIssued: yyyy-MM-ddTHH:mm:ssZ (no milliseconds).
  if (!isValidEtaDateTimeIssued(document.dateTimeIssued)) {
    issues.push({
      code: 'ETA_DATETIME_PATTERN',
      path: 'dateTimeIssued',
      severity: 'error',
      messageKey: 'documents.validation.dateTimeIssuedPattern',
      params: {
        value: String(document.dateTimeIssued ?? ''),
        pattern: 'yyyy-MM-ddTHH:mm:ssZ',
      },
    });
  }

  for (const path of DECIMAL_DOC_PATHS) {
    if (path in document) assertJsonNumber(issues, path, document[path]);
  }

  const taxTotals = document.taxTotals;
  if (Array.isArray(taxTotals)) {
    taxTotals.forEach((t, i) => {
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        assertJsonNumber(issues, `taxTotals[${i}].amount`, (t as JsonObject).amount);
      }
    });
  }

  const invoiceLines = document.invoiceLines;
  if (Array.isArray(invoiceLines)) {
    invoiceLines.forEach((line, i) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return;
      const L = line as JsonObject;
      for (const p of [
        'quantity',
        'salesTotal',
        'total',
        'valueDifference',
        'totalTaxableFees',
        'netTotal',
        'itemsDiscount',
      ]) {
        if (p in L) assertJsonNumber(issues, `invoiceLines[${i}].${p}`, L[p]);
      }
      const uv = L.unitValue;
      if (uv && typeof uv === 'object' && !Array.isArray(uv)) {
        assertJsonNumber(
          issues,
          `invoiceLines[${i}].unitValue.amountEGP`,
          (uv as JsonObject).amountEGP,
        );
      }
    });

    checkEtaTotals(document, issues);
  }

  if (!refs.branchOk) {
    issues.push({
      code: 'BRANCH_INACTIVE',
      path: 'branchId',
      severity: 'error',
      messageKey: 'documents.validation.branchInactive',
    });
  }
  if (!refs.currencyOk) {
    issues.push({
      code: 'CURRENCY_DISABLED',
      path: 'currencyCode',
      severity: 'error',
      messageKey: 'documents.validation.currencyDisabled',
    });
  }
  if (!refs.itemCodesOk) {
    issues.push({
      code: 'ITEM_CODE_UNKNOWN',
      path: 'lines',
      severity: 'error',
      messageKey: 'documents.validation.itemCode',
    });
  }
  if (refs.exchangeRateOk === false) {
    issues.push({
      code: 'EXCHANGE_RATE_MISSING',
      path: 'exchangeRate',
      severity: 'error',
      messageKey: 'documents.validation.exchangeRate',
    });
  }

  const isNote = kind.includes('CREDIT') || kind.includes('DEBIT');
  if (isNote && refs.originalDocumentOk === false) {
    issues.push({
      code: 'REFERENCE_REQUIRED',
      path: 'references',
      severity: 'error',
      messageKey: 'documents.validation.referenceRequired',
    });
  }

  if (lines) {
    lines.forEach((line, i) => {
      const q = Number(line.quantity);
      const p = Number(line.unitPrice);
      if (!(q > 0)) {
        issues.push({
          code: 'INVALID_QUANTITY',
          path: `lines[${i}].quantity`,
          severity: 'error',
          messageKey: 'documents.validation.quantity',
        });
      }
      if (!(p >= 0)) {
        issues.push({
          code: 'INVALID_PRICE',
          path: `lines[${i}].unitPrice`,
          severity: 'error',
          messageKey: 'documents.validation.price',
        });
      }

      const dupes = findDuplicateTaxTypes(line.taxes);
      if (dupes.length) {
        issues.push({
          code: 'DUPLICATE_TAX_TYPE',
          path: `lines[${i}].taxes`,
          severity: 'error',
          messageKey: 'documents.validation.duplicateTaxType',
          params: { taxTypes: dupes.join(', ') },
        });
      }

      (line.taxes ?? []).forEach((tax, tIdx) => {
        if (!isFixedAmountTaxType(tax.taxType)) return;
        const amount = tax.amount;
        if (amount == null || amount === '' || !Number.isFinite(Number(amount))) {
          issues.push({
            code: 'FIXED_TAX_AMOUNT_REQUIRED',
            path: `lines[${i}].taxes[${tIdx}].amount`,
            severity: 'error',
            messageKey: 'documents.validation.fixedTaxAmountRequired',
            params: { taxType: tax.taxType },
          });
        } else if (Number(amount) < 0) {
          issues.push({
            code: 'FIXED_TAX_AMOUNT_NEGATIVE',
            path: `lines[${i}].taxes[${tIdx}].amount`,
            severity: 'error',
            messageKey: 'documents.validation.fixedTaxAmountNegative',
            params: { taxType: tax.taxType },
          });
        }
        const rate = Number(tax.rate);
        if (Number.isFinite(rate) && rate !== 0) {
          issues.push({
            code: 'FIXED_TAX_RATE_MUST_BE_ZERO',
            path: `lines[${i}].taxes[${tIdx}].rate`,
            severity: 'error',
            messageKey: 'documents.validation.fixedTaxRateZero',
            params: { taxType: tax.taxType },
          });
        }
      });

      try {
        calculateLine(line);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('Duplicate TaxType')) {
          // Already reported above as DUPLICATE_TAX_TYPE.
        } else if (msg.includes('requires an explicit amount')) {
          // Already reported as FIXED_TAX_AMOUNT_REQUIRED when amount missing.
        } else {
          issues.push({
            code: 'LINE_CALC_ERROR',
            path: `lines[${i}]`,
            severity: 'error',
            messageKey: 'documents.validation.lineCalc',
          });
        }
      }
    });

    // Fully tax-free invoices are allowed, but warn on domestic kinds that
    // typically declare VAT — ETA may refuse them. User can dismiss / proceed.
    if (
      documentKindTypicallyRequiresTax(kind) &&
      isFullyTaxFree(lines)
    ) {
      issues.push({
        code: 'TAX_TYPICALLY_REQUIRED',
        path: 'invoiceLines',
        severity: 'warning',
        messageKey: 'documents.validation.taxTypicallyRequired',
      });
    }
  }

  return issues;
}
