import type { JsonObject } from './canonical-serialize.js';
import { calculateLine, type LineInput } from './calculate-totals.js';
import { KIND_TO_ETA_TYPE, type DocumentKind } from './builders/document.js';
import { isValidEtaDateTimeIssued } from './eta-formats.js';
import {
  documentKindTypicallyRequiresTax,
  findDuplicateTaxTypes,
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

      try {
        calculateLine(line);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('Duplicate TaxType')) {
          // Already reported above as DUPLICATE_TAX_TYPE.
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
