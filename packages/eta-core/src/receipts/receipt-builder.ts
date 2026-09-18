import { formatEtaDateTimeIssued, toEtaDecimalNumber } from '../eta-formats.js';
import {
  ISSUER_ADDRESS_FIELDS,
  normalizeIssuerAddress,
  type IssuerAddress,
} from '../issuer-address.js';
import { formatMoney, mul } from '../money.js';
import type { ReceiptJsonObject, ReceiptJsonValue } from './receipt-canonical.js';
import {
  calculateReceiptDocumentTotals,
  calculateReceiptLine,
} from './receipt-totals.js';
import { stampReceiptUuid } from './receipt-uuid.js';
import {
  MAX_RECEIPT_LINES,
  RECEIPT_TYPE_VERSION,
  normalizeReceiptType,
  type ReceiptBuildInput,
  type ReceiptDiscountEntry,
  type ReceiptLineInput,
} from './types.js';

function n(value: string | number): number {
  return toEtaDecimalNumber(value);
}

function compactAddress(address: IssuerAddress): ReceiptJsonObject {
  const normalized = normalizeIssuerAddress(address);
  const out: ReceiptJsonObject = {};
  for (const field of ISSUER_ADDRESS_FIELDS) {
    const value = normalized[field];
    if (value) out[field] = value;
  }
  if (!out.country) out.country = 'EG';
  return out;
}

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function discountObject(
  entry: ReceiptDiscountEntry,
  base: string,
): ReceiptJsonObject | undefined {
  const amount =
    entry.amount != null && entry.amount !== ''
      ? formatMoney(entry.amount)
      : entry.rate != null && entry.rate !== ''
        ? mul(base, (Number(entry.rate) / 100).toString())
        : '0.00';
  if (Number(amount) === 0 && !optionalString(entry.description) && !entry.rate) {
    return undefined;
  }
  const obj: ReceiptJsonObject = { amount: n(amount) };
  const description = optionalString(entry.description);
  if (description) obj.description = description;
  if (entry.rate != null && entry.rate !== '') obj.rate = n(entry.rate);
  return obj;
}

function discountArray(
  entries: ReceiptDiscountEntry[] | undefined,
  base: string,
): ReceiptJsonValue[] | undefined {
  if (!entries?.length) return undefined;
  const items = entries
    .map((entry) => discountObject(entry, base))
    .filter((row): row is ReceiptJsonObject => Boolean(row));
  return items.length ? items : undefined;
}

function buildItem(line: ReceiptLineInput): ReceiptJsonObject {
  const computed = calculateReceiptLine(line);
  const obj: ReceiptJsonObject = {
    internalCode: line.internalCode.trim(),
    description: line.description,
    itemType: line.itemType,
    itemCode: line.itemCode,
    unitType: line.unitType,
    quantity: n(line.quantity),
    unitPrice: n(line.unitPrice),
    netSale: n(computed.netSale),
    totalSale: n(computed.totalSale),
    total: n(computed.total),
  };
  const commercial = discountArray(line.commercialDiscountData, computed.totalSale);
  if (commercial) obj.commercialDiscountData = commercial;
  const itemDisc = discountArray(line.itemDiscountData, computed.totalSale);
  if (itemDisc) obj.itemDiscountData = itemDisc;
  if (line.valueDifference != null && line.valueDifference !== '') {
    obj.valueDifference = n(computed.valueDifference);
  }
  if (line.additionalCommercialDiscount) {
    const extra = discountObject(line.additionalCommercialDiscount, computed.totalSale);
    if (extra) obj.additionalCommercialDiscount = extra;
  }
  if (line.additionalItemDiscount) {
    const extra = discountObject(line.additionalItemDiscount, computed.totalSale);
    if (extra) obj.additionalItemDiscount = extra;
  }
  obj.taxableItems = computed.taxAmounts.map((tax) => ({
    taxType: tax.taxType,
    amount: n(tax.amount),
    subType: tax.subType,
    rate: n(tax.rate),
  }));
  return obj;
}

function compactParty(obj: Record<string, unknown> | undefined): ReceiptJsonObject | undefined {
  if (!obj) return undefined;
  const out: ReceiptJsonObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export type BuiltReceipt = {
  etaPayload: ReceiptJsonObject;
  uuid: string;
  previousUUID: string;
  uuidCanonicalString: string;
  canonicalString: string;
  totals: ReturnType<typeof calculateReceiptDocumentTotals>;
};

/**
 * Build a receipt v1.2 JSON, stamp per-receipt uuid, and return canonical strings.
 * Does not submit or sign.
 */
export function buildReceipt(input: ReceiptBuildInput): BuiltReceipt {
  const receiptType = normalizeReceiptType(input.receiptType);
  if (input.lines.length > MAX_RECEIPT_LINES) {
    throw new Error(`Receipt may have at most ${MAX_RECEIPT_LINES} lines`);
  }

  const lineComputed = input.lines.map(calculateReceiptLine);
  const totals = calculateReceiptDocumentTotals(
    lineComputed,
    input.extraReceiptDiscountData,
  );

  const currency = (input.currency || 'EGP').trim().toUpperCase();
  const exchangeRate =
    currency === 'EGP' ? 0 : n(input.exchangeRate ?? 0);

  const header: ReceiptJsonObject = {
    dateTimeIssued: formatEtaDateTimeIssued(input.dateTimeIssued),
    receiptNumber: input.receiptNumber.trim(),
    uuid: '',
    previousUUID: input.previousUUID ?? '',
  };
  if (receiptType === 'r') {
    header.referenceUUID = optionalString(input.referenceUUID) ?? '';
  } else if (optionalString(input.referenceUUID)) {
    header.referenceUUID = input.referenceUUID!.trim();
  }
  header.currency = currency;
  header.exchangeRate = exchangeRate;
  const sOrder = optionalString(input.sOrderNameCode);
  if (sOrder) header.sOrderNameCode = sOrder;
  const delivery = optionalString(input.orderdeliveryMode);
  if (delivery) header.orderdeliveryMode = delivery;
  if (input.grossWeight != null && input.grossWeight !== '') {
    header.grossWeight = n(input.grossWeight);
  }
  if (input.netWeight != null && input.netWeight !== '') {
    header.netWeight = n(input.netWeight);
  }

  const seller: ReceiptJsonObject = {
    rin: input.seller.rin.trim(),
    companyTradeName: input.seller.companyTradeName.trim(),
    branchCode: input.seller.branchCode.trim(),
    branchAddress: compactAddress(input.seller.branchAddress),
    deviceSerialNumber: input.seller.deviceSerialNumber.trim(),
    activityCode: input.seller.activityCode.trim(),
  };
  const syndicate = optionalString(input.seller.syndicateLicenseNumber ?? undefined);
  if (syndicate) seller.syndicateLicenseNumber = syndicate;

  const buyer: ReceiptJsonObject = {
    type: input.buyer.type.trim().toUpperCase(),
  };
  buyer.id = optionalString(input.buyer.id) ?? '';
  buyer.name = optionalString(input.buyer.name) ?? '';
  const mobile = optionalString(input.buyer.mobileNumber);
  if (mobile) buyer.mobileNumber = mobile;
  const paymentNumber = optionalString(input.buyer.paymentNumber);
  if (paymentNumber) buyer.paymentNumber = paymentNumber;

  const payload: ReceiptJsonObject = {
    header,
    documentType: {
      receiptType,
      typeVersion: input.typeVersion?.trim() || RECEIPT_TYPE_VERSION,
    },
    seller,
    buyer,
    itemData: input.lines.map(buildItem),
    totalSales: n(totals.totalSales),
    totalCommercialDiscount: n(totals.totalCommercialDiscount),
    totalItemsDiscount: n(totals.totalItemsDiscount),
  };

  if (input.extraReceiptDiscountData?.length) {
    payload.extraReceiptDiscountData = input.extraReceiptDiscountData.map((row) => {
      const obj: ReceiptJsonObject = { amount: n(formatMoney(row.amount)) };
      const description = optionalString(row.description);
      if (description) obj.description = description;
      return obj;
    });
  }

  payload.netAmount = n(totals.netAmount);
  payload.feesAmount = 0;
  payload.totalAmount = n(totals.totalAmount);
  payload.taxTotals = totals.taxTotals.map((row) => ({
    taxType: row.taxType,
    amount: n(row.amount),
  }));
  payload.paymentMethod = input.paymentMethod.trim();
  payload.adjustment = 0;

  const contractor = compactParty(input.contractor);
  if (contractor) payload.contractor = contractor;
  const beneficiary = compactParty(input.beneficiary);
  if (beneficiary) payload.beneficiary = beneficiary;

  const stamped = stampReceiptUuid(payload);
  return {
    etaPayload: stamped.receipt,
    uuid: stamped.uuid,
    previousUUID: String(header.previousUUID ?? ''),
    uuidCanonicalString: stamped.uuidCanonicalString,
    canonicalString: stamped.canonicalString,
    totals,
  };
}
