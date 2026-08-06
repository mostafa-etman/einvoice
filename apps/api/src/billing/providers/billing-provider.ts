import type { BillingProviderId, PlanCode, SubscriptionStatus } from '@prisma/client';

export type SelfServePlanCode = Extract<PlanCode, 'STARTER' | 'PRO'>;
export type ChangePlanCode = Extract<PlanCode, 'FREE' | 'STARTER' | 'PRO'>;

export interface BillingCustomerRef {
  tenantId: string;
  email: string;
  name?: string | null;
}

export interface CreateCustomerResult {
  providerCustomerId: string;
}

export interface CreateCheckoutSessionParams {
  tenantId: string;
  planCode: SelfServePlanCode;
  /** Provider-native price/product identifier (from `Plan.stripePriceId` for Stripe). */
  stripePriceId?: string | null;
  customerId?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
}

/** Provider-agnostic normalized shape produced after signature verification. */
export interface NormalizedWebhookEvent {
  providerEventId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface SubscriptionUpdateFromWebhook {
  tenantId?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  status?: SubscriptionStatus;
  planCode?: ChangePlanCode;
}

export interface InvoiceFromWebhook {
  providerInvoiceId: string;
  status: string;
  amountCents: number;
  currency: string;
  hostedInvoiceUrl?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface ApplyWebhookEventResult {
  outcome: 'success' | 'ignored' | 'error';
  subscriptionUpdate?: SubscriptionUpdateFromWebhook;
  invoice?: InvoiceFromWebhook;
  note?: string;
}

/**
 * Billing gateway abstraction (R3 / research.md). Stripe is the v1 implementation;
 * a local Egyptian gateway (Paymob/Fawry/Kashier) can implement this same contract
 * later without touching entitlement/quota logic.
 */
export interface BillingProvider {
  readonly id: BillingProviderId;

  createCustomer(input: BillingCustomerRef): Promise<CreateCustomerResult>;

  createCheckoutSession(
    input: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult>;

  /** Verify the provider signature (when configured) and normalize the payload. Throws on invalid signature. */
  verifyAndParseWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): NormalizedWebhookEvent;

  /** Map a normalized event to the internal subscription/invoice change it implies. */
  applyWebhookEvent(event: NormalizedWebhookEvent): ApplyWebhookEventResult;
}

export const BILLING_PROVIDER = 'BILLING_PROVIDER' as const;
