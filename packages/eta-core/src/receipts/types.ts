import type { LineTaxInput } from '../calculate-totals.js';
import type { IssuerAddress } from '../issuer-address.js';

/** ETA receipt v1.2 document types. Tenant/activity picks one — never hardcode. */
export const RECEIPT_TYPES = ['s', 'r', 'SR'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

export const RECEIPT_TYPE_VERSION = '1.2';

/** v1.2: person buyer id/name become mandatory at this EGP total. */
export const RECEIPT_BUYER_ID_THRESHOLD_EGP = 150_000;

export const RECEIPT_PAYMENT_METHODS = [
  'C',
  'V',
  'CC',
  'VC',
  'VO',
  'PR',
  'GC',
  'P',
  'O',
] as const;
export type ReceiptPaymentMethod = (typeof RECEIPT_PAYMENT_METHODS)[number];

export const RECEIPT_BUYER_TYPES = ['P', 'B', 'F'] as const;
export type ReceiptBuyerType = (typeof RECEIPT_BUYER_TYPES)[number];

export const MAX_RECEIPT_LINES = 300;

export type ReceiptDiscountEntry = {
  amount?: string;
  description?: string;
  rate?: string;
};

export type ReceiptLineInput = {
  /** Mandatory on every receipt line (ETA receipt v1.2). */
  internalCode: string;
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: string;
  /** Scalar unit price — receipts do not use invoice unitValue objects. */
  unitPrice: string;
  commercialDiscountData?: ReceiptDiscountEntry[];
  itemDiscountData?: ReceiptDiscountEntry[];
  additionalCommercialDiscount?: ReceiptDiscountEntry;
  additionalItemDiscount?: ReceiptDiscountEntry;
  valueDifference?: string;
  taxes?: LineTaxInput[];
};

export type ReceiptSellerInput = {
  rin: string;
  companyTradeName: string;
  branchCode: string;
  branchAddress: IssuerAddress;
  deviceSerialNumber: string;
  activityCode: string;
  syndicateLicenseNumber?: string | null;
};

export type ReceiptBuyerInput = {
  type: ReceiptBuyerType;
  id?: string;
  name?: string;
  mobileNumber?: string;
  paymentNumber?: string;
};

export type ReceiptExtraDiscount = {
  amount: string;
  description?: string;
};

export type ReceiptBuildInput = {
  receiptType: ReceiptType;
  typeVersion?: string;
  dateTimeIssued: string;
  receiptNumber: string;
  /** POS chain: empty string on that POS's first receipt. */
  previousUUID: string;
  /** Required on return receipts (`r`). */
  referenceUUID?: string;
  currency: string;
  exchangeRate?: string | number;
  sOrderNameCode?: string;
  orderdeliveryMode?: string;
  grossWeight?: string | number;
  netWeight?: string | number;
  seller: ReceiptSellerInput;
  buyer: ReceiptBuyerInput;
  lines: ReceiptLineInput[];
  extraReceiptDiscountData?: ReceiptExtraDiscount[];
  paymentMethod: ReceiptPaymentMethod | string;
  contractor?: Record<string, unknown>;
  beneficiary?: Record<string, unknown>;
};

export function isReceiptType(value: string): value is ReceiptType {
  return (RECEIPT_TYPES as readonly string[]).includes(value);
}

export function normalizeReceiptType(value: string | null | undefined): ReceiptType {
  const raw = (value ?? '').trim();
  if (isReceiptType(raw)) return raw;
  const upper = raw.toUpperCase();
  if (upper === 'S') return 's';
  if (upper === 'R') return 'r';
  if (upper === 'SR') return 'SR';
  throw new Error(`Unsupported receiptType "${value ?? ''}": use s, r, or SR`);
}

export function isReceiptPaymentMethod(
  value: string,
): value is ReceiptPaymentMethod {
  return (RECEIPT_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isReceiptBuyerType(value: string): value is ReceiptBuyerType {
  return (RECEIPT_BUYER_TYPES as readonly string[]).includes(value);
}

export function buyerIdentityRequired(
  buyerType: string,
  totalAmount: number,
): boolean {
  const t = buyerType.trim().toUpperCase();
  if (t === 'B' || t === 'F') return true;
  if (t === 'P') return totalAmount >= RECEIPT_BUYER_ID_THRESHOLD_EGP;
  return false;
}
