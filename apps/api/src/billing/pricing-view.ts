import type { Addon, Plan } from '@prisma/client';

export const BILLING_CURRENCY = 'EGP';
export const BILLING_PERIOD = 'annual';

const B2B_KINDS = new Set([
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'EXPORT_INVOICE',
  'EXPORT_CREDIT_NOTE',
  'EXPORT_DEBIT_NOTE',
]);

export function savingsPercent(official: number, discounted: number): number {
  if (official <= 0) return 0;
  return Math.max(0, Math.round(((official - discounted) / official) * 100));
}

export function docCapacityFromPoints(includedPoints: number, invoicePoints: number): number {
  const cost = Math.max(1, Math.floor(invoicePoints) || 1);
  return Math.floor(Math.max(0, includedPoints) / cost);
}

export function isB2bKind(kind: string): boolean {
  return B2B_KINDS.has(kind.trim().toUpperCase());
}

export function toPlanView(
  plan: Plan,
  invoicePromoPoints: number,
): {
  code: string;
  name: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  documentQuota: number;
  branchQuota: number;
  deviceQuota: number;
  selfServe: boolean;
  includedPoints: number;
  officialPriceEgp: number;
  discountedPriceEgp: number;
  savingsPercent: number;
  maxUsers: number;
  maxCompanies: number;
  docCapacity: number;
  isTrial: boolean;
  isPublic: boolean;
  currency: typeof BILLING_CURRENCY;
  billingPeriod: typeof BILLING_PERIOD;
  priceDisplay: string | null;
} {
  const official = plan.officialPriceEgp;
  const discounted = plan.discountedPriceEgp;
  return {
    code: plan.code,
    name: plan.nameEn,
    nameAr: plan.nameAr,
    descriptionEn: plan.descriptionEn,
    descriptionAr: plan.descriptionAr,
    documentQuota: plan.documentQuota,
    branchQuota: plan.branchQuota,
    deviceQuota: plan.deviceQuota,
    selfServe: plan.selfServe,
    includedPoints: plan.includedPoints,
    officialPriceEgp: official,
    discountedPriceEgp: discounted,
    savingsPercent: savingsPercent(official, discounted),
    maxUsers: plan.maxUsers,
    maxCompanies: plan.maxCompanies,
    docCapacity: docCapacityFromPoints(plan.includedPoints, invoicePromoPoints),
    isTrial: plan.isTrial,
    isPublic: plan.isPublic,
    currency: BILLING_CURRENCY,
    billingPeriod: BILLING_PERIOD,
    priceDisplay: discounted > 0 ? `${discounted} ${BILLING_CURRENCY}` : null,
  };
}

export function toAddonView(addon: Addon) {
  return {
    code: addon.code,
    kind: addon.kind,
    name: addon.nameEn,
    nameAr: addon.nameAr,
    descriptionEn: addon.descriptionEn,
    descriptionAr: addon.descriptionAr,
    quantity: addon.quantity,
    officialPriceEgp: addon.officialPriceEgp,
    discountedPriceEgp: addon.discountedPriceEgp,
    savingsPercent: savingsPercent(addon.officialPriceEgp, addon.discountedPriceEgp),
    currency: BILLING_CURRENCY,
    isActive: addon.isActive,
    sortOrder: addon.sortOrder,
  };
}
