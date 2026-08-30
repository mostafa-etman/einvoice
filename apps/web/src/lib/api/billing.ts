import { apiFetch } from './client';

export type PlanCode = string;
export type SubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'READ_ONLY'
  | 'SUSPENDED'
  | 'TRIAL'
  | 'CANCELLED';

export type PlanView = {
  code: PlanCode;
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
  currency: 'EGP';
  billingPeriod: 'annual';
  priceDisplay: string | null;
};

export type AddonView = {
  code: string;
  kind: 'POINTS' | 'USER' | 'COMPANY';
  name: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  quantity: number;
  officialPriceEgp: number;
  discountedPriceEgp: number;
  savingsPercent: number;
  currency: 'EGP';
  isActive: boolean;
  sortOrder: number;
};

export type PricingCatalog = {
  currency: 'EGP';
  billingPeriod: 'annual';
  trialDays: number;
  trialPoints: number;
  costs: { invoicePromo: number; invoiceStandard: number; receipt: number };
  plans: PlanView[];
  addons: AddonView[];
};

export type SubscriptionView = {
  status: SubscriptionStatus;
  plan: {
    code: PlanCode;
    name: string;
    nameAr?: string;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    selfServe: boolean;
    includedPoints: number;
    officialPriceEgp?: number;
    discountedPriceEgp?: number;
    maxUsers?: number;
    maxCompanies?: number;
    isTrial?: boolean;
  };
  graceEndsAt: string | null;
  entitlements: {
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
  accessMode: 'FULL' | 'READ_ONLY' | 'BLOCKED' | 'PENDING';
  pointsBalance: number;
  trialEndsAt?: string | null;
  trialActive?: boolean;
  sendBlocked?: boolean;
  sendBlockedReason?: 'TRIAL_ENDED' | 'INSUFFICIENT_POINTS' | null;
  extraUsers?: number;
  extraCompanies?: number;
};

export type QuotaMeter = { used: number; limit: number };

export type QuotaSnapshot = {
  period: { timezone: string; monthStart: string; monthEnd: string };
  documents: QuotaMeter;
  branches: QuotaMeter;
  devices: QuotaMeter;
  users?: QuotaMeter;
  companies?: QuotaMeter;
  entitlements: {
    planCode: PlanCode;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
};

export type InvoiceRef = {
  id: string;
  provider: string;
  providerInvoiceId: string;
  status: string;
  amountCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  createdAt: string;
};

export function fetchPlans() {
  return apiFetch<{ plans: PlanView[] }>('/billing/plans');
}

export function fetchCatalog() {
  return apiFetch<PricingCatalog>('/billing/catalog');
}

export function fetchSubscription() {
  return apiFetch<SubscriptionView>('/billing/subscription', { tenantScoped: true });
}

export function fetchQuotas() {
  return apiFetch<QuotaSnapshot>('/billing/quotas', { tenantScoped: true });
}

export type ManualCheckoutResult = {
  mode: 'manual';
  planCode: string;
  planName: string;
  planNameAr: string;
  whatsappUrl: string;
  whatsappDisplay: string;
};

/** Kept for API compatibility. Online Stripe checkout is disabled; this returns WhatsApp contact. */
export function startCheckout(input: { planCode: string; successUrl?: string; cancelUrl?: string }) {
  return apiFetch<ManualCheckoutResult>('/billing/checkout', {
    method: 'POST',
    tenantScoped: true,
    body: input,
  });
}

export function changePlan(planCode: 'FREE' | 'STARTER' | 'PRO') {
  return apiFetch<SubscriptionView>('/billing/change-plan', {
    method: 'POST',
    tenantScoped: true,
    body: { planCode },
  });
}

export function requestEnterprise(message?: string) {
  return apiFetch<{ accepted: boolean }>('/billing/enterprise-request', {
    method: 'POST',
    tenantScoped: true,
    body: { message },
  });
}

export function fetchInvoices() {
  return apiFetch<{ items: InvoiceRef[] }>('/billing/invoices', { tenantScoped: true });
}
