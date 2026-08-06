import { apiFetch } from './client';

export type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED';

export type PlanView = {
  code: PlanCode;
  name: string;
  nameAr: string;
  documentQuota: number;
  branchQuota: number;
  deviceQuota: number;
  selfServe: boolean;
  priceDisplay: string | null;
};

export type SubscriptionView = {
  status: SubscriptionStatus;
  plan: {
    code: PlanCode;
    name: string;
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    selfServe: boolean;
  };
  graceEndsAt: string | null;
  entitlements: {
    documentQuota: number;
    branchQuota: number;
    deviceQuota: number;
    overrideActive: boolean;
  };
  accessMode: 'FULL' | 'READ_ONLY' | 'BLOCKED';
};

export type QuotaMeter = { used: number; limit: number };

export type QuotaSnapshot = {
  period: { timezone: string; monthStart: string; monthEnd: string };
  documents: QuotaMeter;
  branches: QuotaMeter;
  devices: QuotaMeter;
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

export function fetchSubscription() {
  return apiFetch<SubscriptionView>('/billing/subscription', { tenantScoped: true });
}

export function fetchQuotas() {
  return apiFetch<QuotaSnapshot>('/billing/quotas', { tenantScoped: true });
}

export function startCheckout(input: {
  planCode: 'STARTER' | 'PRO';
  successUrl?: string;
  cancelUrl?: string;
}) {
  return apiFetch<{ checkoutUrl?: string; [key: string]: unknown }>('/billing/checkout', {
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
