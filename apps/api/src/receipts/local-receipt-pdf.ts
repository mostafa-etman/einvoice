import type {
  LocalInvoicePdfInput,
  LocalInvoicePdfLocale,
} from '../documents/local-invoice-pdf';

const EN = {
  title: 'Receipt preview',
  localNote: 'Local preview — not the official ETA printout',
  issuer: 'Seller',
  receiver: 'Buyer',
  documentType: 'Receipt type',
  internalId: 'Receipt number',
};

const AR = {
  title: 'معاينة الإيصال',
  localNote: 'معاينة محلية — ليست الطبعة الرسمية لمصلحة الضرائب',
  issuer: 'البائع',
  receiver: 'المشتري',
  documentType: 'نوع الإيصال',
  internalId: 'رقم الإيصال',
};

export function receiptPdfLabelOverrides(locale: LocalInvoicePdfLocale) {
  return locale === 'ar' ? AR : EN;
}

export function receiptKindLabel(receiptType: string, locale: LocalInvoicePdfLocale) {
  if (receiptType === 'r') return locale === 'ar' ? 'r — مرتجع' : 'r — Return';
  if (receiptType === 'SR') return locale === 'ar' ? 'SR — تجزئة' : 'SR — Retail';
  return locale === 'ar' ? 's — بيع' : 's — Sale';
}

export type ReceiptPdfPayload = {
  header?: { receiptNumber?: string; dateTimeIssued?: string; currency?: string };
  receiptType?: string;
  documentType?: { receiptType?: string };
  receiptNumber?: string;
  dateTimeIssued?: string;
  currencyCode?: string;
  seller?: Record<string, unknown> | null;
  buyer?: Record<string, unknown> | null;
  itemData?: Array<Record<string, unknown>>;
  totalSales?: unknown;
  discounts?: unknown;
  netAmount?: unknown;
  totalAmount?: unknown;
  taxTotals?: unknown;
};

export function receiptPayloadToPdfInput(opts: {
  locale: LocalInvoicePdfLocale;
  payload: ReceiptPdfPayload;
  logo?: LocalInvoicePdfInput['logo'];
}): LocalInvoicePdfInput {
  const { locale, payload, logo } = opts;
  const header = payload.header ?? {};
  const seller = payload.seller ?? {};
  const buyer = payload.buyer ?? {};
  const lines = Array.isArray(payload.itemData) ? payload.itemData : [];
  const address =
    seller.branchAddress && typeof seller.branchAddress === 'object'
      ? (seller.branchAddress as Record<string, unknown>)
      : null;
  const receiptType = String(
    payload.documentType?.receiptType ?? payload.receiptType ?? 's',
  );
  return {
    locale,
    kind: receiptKindLabel(receiptType, locale),
    internalId: String(header.receiptNumber ?? payload.receiptNumber ?? ''),
    issueDateTime: String(header.dateTimeIssued ?? payload.dateTimeIssued ?? ''),
    currencyCode: String(header.currency ?? payload.currencyCode ?? 'EGP'),
    taxpayerActivityCode: String(seller.activityCode ?? ''),
    issuer: {
      type: 'B',
      id: String(seller.rin ?? ''),
      name: String(seller.companyTradeName ?? ''),
      address,
    },
    receiver: {
      type: String(buyer.type ?? ''),
      id: String(buyer.id ?? ''),
      name: String(buyer.name ?? ''),
    },
    lines: lines.map((l) => {
      const discounts = Array.isArray(l.commercialDiscountData)
        ? (l.commercialDiscountData as Array<Record<string, unknown>>)
        : [];
      const discountAmount = discounts.reduce(
        (sum, d) => sum + Number(d.amount ?? 0),
        0,
      );
      const taxesRaw = Array.isArray(l.taxableItems) ? l.taxableItems : [];
      return {
        description: String(l.description ?? ''),
        itemType: String(l.itemType ?? ''),
        itemCode: String(l.itemCode ?? ''),
        unitType: String(l.unitType ?? ''),
        quantity: String(l.quantity ?? ''),
        unitPrice: String(l.unitPrice ?? ''),
        discountAmount: discountAmount ? String(discountAmount) : '0',
        taxes: taxesRaw.map((t) => {
          const row = t as Record<string, unknown>;
          return {
            taxType: String(row.taxType ?? ''),
            subType: String(row.subType ?? ''),
            rate: String(row.rate ?? '0'),
            amount: row.amount != null ? String(row.amount) : undefined,
          };
        }),
      };
    }),
    totals: {
      totalSalesAmount: String(payload.totalSales ?? '0'),
      totalDiscountAmount: String(payload.discounts ?? '0'),
      netAmount: String(payload.netAmount ?? '0'),
      totalAmount: String(payload.totalAmount ?? '0'),
      taxTotals: payload.taxTotals,
    },
    logo: logo ?? null,
    labelOverrides: receiptPdfLabelOverrides(locale),
  };
}
