import { isValidEtaDateTimeIssued } from '../eta-formats.js';
import type { ValidationIssue } from '../local-validator.js';
import { ETA_TOTAL_TOLERANCE } from '../local-validator.js';
import { formatMoney } from '../money.js';
import { missingIssuerAddressFields } from '../issuer-address.js';
import type { ReceiptJsonObject } from './receipt-canonical.js';
import { calculateReceiptDocumentTotals, calculateReceiptLine } from './receipt-totals.js';
import {
  MAX_RECEIPT_LINES,
  RECEIPT_BUYER_ID_THRESHOLD_EGP,
  RECEIPT_TYPE_VERSION,
  buyerIdentityRequired,
  isReceiptBuyerType,
  isReceiptPaymentMethod,
  isReceiptType,
  type ReceiptBuildInput,
  type ReceiptType,
} from './types.js';

function issue(
  code: string,
  path: string,
  messageKey: string,
  params?: Record<string, string>,
): ValidationIssue {
  return { code, path, severity: 'error', messageKey, params };
}

function asObject(value: unknown): ReceiptJsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as ReceiptJsonObject;
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function amountsClose(a: string, b: unknown): boolean {
  const right = typeof b === 'number' ? formatMoney(b) : formatMoney(String(b ?? '0'));
  return Math.abs(Number(a) - Number(right)) <= ETA_TOTAL_TOLERANCE;
}

function assertJsonNumber(issues: ValidationIssue[], path: string, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(
      issue('ETA_NUMBER_EXPECTED', path, 'receipts.validation.numberExpected', {
        path,
        got: typeof value,
      }),
    );
  }
}

export function validateReceipt(params: {
  document: ReceiptJsonObject;
  input?: ReceiptBuildInput;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { document, input } = params;
  const header = asObject(document.header) ?? {};
  const documentType = asObject(document.documentType) ?? {};
  const seller = asObject(document.seller) ?? {};
  const buyer = asObject(document.buyer) ?? {};
  const itemData = Array.isArray(document.itemData) ? document.itemData : null;

  const receiptType = str(documentType.receiptType) as ReceiptType | '';
  if (!isReceiptType(receiptType)) {
    issues.push(
      issue('RECEIPT_TYPE_INVALID', 'documentType.receiptType', 'receipts.validation.receiptType', {
        value: receiptType,
      }),
    );
  }

  if (str(documentType.typeVersion) !== RECEIPT_TYPE_VERSION) {
    issues.push(
      issue(
        'RECEIPT_VERSION_MISMATCH',
        'documentType.typeVersion',
        'receipts.validation.typeVersion',
        { expected: RECEIPT_TYPE_VERSION, got: str(documentType.typeVersion) },
      ),
    );
  }

  if (!isValidEtaDateTimeIssued(header.dateTimeIssued)) {
    issues.push(
      issue(
        'ETA_DATETIME_PATTERN',
        'header.dateTimeIssued',
        'receipts.validation.dateTimeIssuedPattern',
        { value: String(header.dateTimeIssued ?? ''), pattern: 'yyyy-MM-ddTHH:mm:ssZ' },
      ),
    );
  }

  if (!str(header.receiptNumber)) {
    issues.push(
      issue('REQUIRED_FIELD', 'header.receiptNumber', 'receipts.validation.required', {
        path: 'header.receiptNumber',
      }),
    );
  } else if (str(header.receiptNumber).length > 50) {
    issues.push(
      issue('RECEIPT_NUMBER_LENGTH', 'header.receiptNumber', 'receipts.validation.receiptNumberLength'),
    );
  }

  if (
    typeof header.uuid !== 'string' ||
    (header.uuid !== '' && !/^[0-9a-f]{64}$/.test(header.uuid))
  ) {
    issues.push(issue('RECEIPT_UUID', 'header.uuid', 'receipts.validation.uuid'));
  }
  if (typeof header.previousUUID !== 'string') {
    issues.push(
      issue('REQUIRED_FIELD', 'header.previousUUID', 'receipts.validation.required', {
        path: 'header.previousUUID',
      }),
    );
  }

  if (receiptType === 'r' && !str(header.referenceUUID)) {
    issues.push(
      issue('RETURN_REFERENCE_REQUIRED', 'header.referenceUUID', 'receipts.validation.referenceUuid'),
    );
  }
  if (receiptType === 'SR' && !str(header.orderdeliveryMode)) {
    issues.push(
      issue(
        'ORDER_DELIVERY_MODE_REQUIRED',
        'header.orderdeliveryMode',
        'receipts.validation.orderDeliveryMode',
      ),
    );
  }

  if (!str(header.currency)) {
    issues.push(
      issue('REQUIRED_FIELD', 'header.currency', 'receipts.validation.required', {
        path: 'header.currency',
      }),
    );
  }
  assertJsonNumber(issues, 'header.exchangeRate', header.exchangeRate);
  if (str(header.currency).toUpperCase() === 'EGP' && num(header.exchangeRate) !== 0) {
    issues.push(
      issue('EGP_EXCHANGE_RATE', 'header.exchangeRate', 'receipts.validation.egpExchangeRate'),
    );
  }

  for (const path of [
    'rin',
    'companyTradeName',
    'branchCode',
    'deviceSerialNumber',
    'activityCode',
  ] as const) {
    if (!str(seller[path])) {
      issues.push(
        issue('REQUIRED_FIELD', `seller.${path}`, 'receipts.validation.required', {
          path: `seller.${path}`,
        }),
      );
    }
  }
  const address = asObject(seller.branchAddress);
  if (!address) {
    issues.push(
      issue('REQUIRED_FIELD', 'seller.branchAddress', 'receipts.validation.required', {
        path: 'seller.branchAddress',
      }),
    );
  } else {
    const missing = missingIssuerAddressFields(address);
    for (const field of missing) {
      issues.push(
        issue(
          'SELLER_ADDRESS_INCOMPLETE',
          `seller.branchAddress.${field}`,
          'receipts.validation.sellerAddress',
          { field },
        ),
      );
    }
  }

  const buyerType = str(buyer.type);
  if (!isReceiptBuyerType(buyerType)) {
    issues.push(
      issue('BUYER_TYPE_INVALID', 'buyer.type', 'receipts.validation.buyerType', {
        value: buyerType,
      }),
    );
  }

  if (!isReceiptPaymentMethod(str(document.paymentMethod))) {
    issues.push(
      issue('PAYMENT_METHOD_REQUIRED', 'paymentMethod', 'receipts.validation.paymentMethod'),
    );
  }

  if (num(document.feesAmount) !== 0) {
    issues.push(issue('FEES_AMOUNT_ZERO', 'feesAmount', 'receipts.validation.feesAmount'));
  }
  if (num(document.adjustment) !== 0) {
    issues.push(issue('ADJUSTMENT_ZERO', 'adjustment', 'receipts.validation.adjustment'));
  }
  assertJsonNumber(issues, 'feesAmount', document.feesAmount);
  assertJsonNumber(issues, 'adjustment', document.adjustment);
  assertJsonNumber(issues, 'totalSales', document.totalSales);
  assertJsonNumber(issues, 'netAmount', document.netAmount);
  assertJsonNumber(issues, 'totalAmount', document.totalAmount);
  assertJsonNumber(issues, 'totalCommercialDiscount', document.totalCommercialDiscount);
  assertJsonNumber(issues, 'totalItemsDiscount', document.totalItemsDiscount);

  if (!itemData || itemData.length === 0) {
    issues.push(
      issue('REQUIRED_FIELD', 'itemData', 'receipts.validation.required', { path: 'itemData' }),
    );
  } else if (itemData.length > MAX_RECEIPT_LINES) {
    issues.push(
      issue('RECEIPT_LINE_LIMIT', 'itemData', 'receipts.validation.lineLimit', {
        max: String(MAX_RECEIPT_LINES),
      }),
    );
  } else {
    itemData.forEach((raw, i) => {
      const line = asObject(raw);
      if (!line) return;
      if (!str(line.internalCode)) {
        issues.push(
          issue(
            'INTERNAL_CODE_REQUIRED',
            `itemData[${i}].internalCode`,
            'receipts.validation.internalCode',
            { line: String(i + 1) },
          ),
        );
      }
      for (const field of [
        'description',
        'itemType',
        'itemCode',
        'unitType',
      ] as const) {
        if (!str(line[field])) {
          issues.push(
            issue(
              'REQUIRED_FIELD',
              `itemData[${i}].${field}`,
              'receipts.validation.required',
              { path: `itemData[${i}].${field}` },
            ),
          );
        }
      }
      for (const field of ['quantity', 'unitPrice', 'netSale', 'totalSale', 'total'] as const) {
        assertJsonNumber(issues, `itemData[${i}].${field}`, line[field]);
      }
      if (line.unitValue != null) {
        issues.push(
          issue(
            'RECEIPT_UNIT_PRICE_SCALAR',
            `itemData[${i}].unitPrice`,
            'receipts.validation.unitPriceScalar',
          ),
        );
      }
    });
  }

  const totalAmount = num(document.totalAmount) ?? 0;
  if (buyerIdentityRequired(buyerType, totalAmount)) {
    if (!str(buyer.id)) {
      issues.push(
        issue('BUYER_ID_REQUIRED', 'buyer.id', 'receipts.validation.buyerId', {
          type: buyerType,
          threshold: String(RECEIPT_BUYER_ID_THRESHOLD_EGP),
        }),
      );
    }
    if (!str(buyer.name)) {
      issues.push(
        issue('BUYER_NAME_REQUIRED', 'buyer.name', 'receipts.validation.buyerName', {
          type: buyerType,
          threshold: String(RECEIPT_BUYER_ID_THRESHOLD_EGP),
        }),
      );
    }
  }

  if (input?.lines?.length) {
    const recomputedLines = input.lines.map(calculateReceiptLine);
    const recomputed = calculateReceiptDocumentTotals(
      recomputedLines,
      input.extraReceiptDiscountData,
    );
    const checks: Array<[string, string, unknown]> = [
      ['totalSales', recomputed.totalSales, document.totalSales],
      ['netAmount', recomputed.netAmount, document.netAmount],
      ['totalAmount', recomputed.totalAmount, document.totalAmount],
      ['totalCommercialDiscount', recomputed.totalCommercialDiscount, document.totalCommercialDiscount],
      ['totalItemsDiscount', recomputed.totalItemsDiscount, document.totalItemsDiscount],
    ];
    for (const [path, expected, actual] of checks) {
      if (!amountsClose(expected, actual)) {
        issues.push(
          issue('TOTALS_MISMATCH', path, 'receipts.validation.totalsMismatch', {
            path,
            expected,
            actual: String(actual ?? ''),
          }),
        );
      }
    }
  }

  return issues;
}

export function assertReceiptValid(params: {
  document: ReceiptJsonObject;
  input?: ReceiptBuildInput;
}): ValidationIssue[] {
  return validateReceipt(params).filter((row) => row.severity === 'error');
}
