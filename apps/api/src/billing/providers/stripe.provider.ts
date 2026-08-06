import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { loadEnv } from '../../config/env';
import type {
  ApplyWebhookEventResult,
  BillingCustomerRef,
  BillingProvider,
  CheckoutSessionResult,
  CreateCheckoutSessionParams,
  CreateCustomerResult,
  NormalizedWebhookEvent,
} from './billing-provider';

const DEFAULT_SUCCESS_URL = 'https://web.localhost/en/billing?checkout=success';
const DEFAULT_CANCEL_URL = 'https://web.localhost/en/billing?checkout=cancel';

/** Stripe test-mode adapter (research.md R3). Every method fails loudly and clearly when STRIPE_SECRET_KEY is unset. */
@Injectable()
export class StripeBillingProvider implements BillingProvider {
  readonly id = 'stripe' as const;
  private readonly logger = new Logger(StripeBillingProvider.name);
  private client: Stripe | null = null;

  private get secretKey(): string | undefined {
    return loadEnv().STRIPE_SECRET_KEY?.trim() || undefined;
  }

  private get webhookSecret(): string | undefined {
    return loadEnv().STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  }

  private getClient(): Stripe {
    const key = this.secretKey;
    if (!key) {
      throw new Error(
        'STRIPE_SECRET_KEY is not configured; cannot use the Stripe billing provider',
      );
    }
    if (!this.client) {
      this.client = new Stripe(key);
    }
    return this.client;
  }

  async createCustomer(input: BillingCustomerRef): Promise<CreateCustomerResult> {
    const client = this.getClient();
    const customer = await client.customers.create({
      email: input.email,
      name: input.name ?? undefined,
      metadata: { tenantId: input.tenantId },
    });
    return { providerCustomerId: customer.id };
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult> {
    const client = this.getClient();
    if (!input.stripePriceId) {
      throw new Error(
        `Plan ${input.planCode} has no stripePriceId configured; cannot start Stripe checkout`,
      );
    }
    const metadata = { tenantId: input.tenantId, planCode: input.planCode };
    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: input.stripePriceId, quantity: 1 }],
      customer: input.customerId ?? undefined,
      client_reference_id: input.tenantId,
      metadata,
      subscription_data: { metadata },
      success_url: input.successUrl ?? DEFAULT_SUCCESS_URL,
      cancel_url: input.cancelUrl ?? DEFAULT_CANCEL_URL,
    });
    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }
    return { checkoutUrl: session.url };
  }

  verifyAndParseWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): NormalizedWebhookEvent {
    const secret = this.webhookSecret;
    if (secret) {
      if (!signature) {
        throw new Error('Missing Stripe-Signature header');
      }
      // Stripe.webhooks is a static helper — verification is local HMAC, no API key required.
      const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      return {
        providerEventId: event.id,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
      };
    }
    this.logger.warn(
      'STRIPE_WEBHOOK_SECRET is not set — skipping signature verification (dev/test only)',
    );
    const parsed = JSON.parse(rawBody.toString()) as { id: string; type: string };
    return { providerEventId: parsed.id, type: parsed.type, payload: parsed };
  }

  applyWebhookEvent(event: NormalizedWebhookEvent): ApplyWebhookEventResult {
    const data = (event.payload as { data?: { object?: Record<string, unknown> } }).data
      ?.object;
    if (!data) {
      return { outcome: 'ignored', note: 'missing_data_object' };
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = data as {
          metadata?: { tenantId?: string; planCode?: string };
          client_reference_id?: string | null;
          customer?: string | null;
          subscription?: string | null;
        };
        const tenantId = session.metadata?.tenantId ?? session.client_reference_id ?? undefined;
        const planCode = session.metadata?.planCode as 'STARTER' | 'PRO' | undefined;
        if (!tenantId || !planCode) {
          return { outcome: 'ignored', note: 'missing_tenant_metadata' };
        }
        return {
          outcome: 'success',
          subscriptionUpdate: {
            tenantId,
            planCode,
            status: 'ACTIVE',
            providerCustomerId: session.customer ?? undefined,
            providerSubscriptionId: session.subscription ?? undefined,
          },
        };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = data as {
          id: string;
          status?: string;
          amount_paid?: number;
          amount_due?: number;
          currency?: string;
          hosted_invoice_url?: string | null;
          period_start?: number;
          period_end?: number;
          metadata?: { tenantId?: string };
          subscription_details?: { metadata?: { tenantId?: string } };
          lines?: { data?: Array<{ metadata?: { tenantId?: string } }> };
        };
        const tenantId =
          invoice.metadata?.tenantId ??
          invoice.subscription_details?.metadata?.tenantId ??
          invoice.lines?.data?.[0]?.metadata?.tenantId;
        if (!tenantId) {
          return { outcome: 'ignored', note: 'missing_tenant_metadata' };
        }
        const isFailed = event.type === 'invoice.payment_failed';
        return {
          outcome: 'success',
          subscriptionUpdate: { tenantId, status: isFailed ? 'PAST_DUE' : 'ACTIVE' },
          invoice: {
            providerInvoiceId: invoice.id,
            status: invoice.status ?? (isFailed ? 'open' : 'paid'),
            amountCents: isFailed ? (invoice.amount_due ?? 0) : (invoice.amount_paid ?? 0),
            currency: invoice.currency ?? 'usd',
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
            periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
          },
        };
      }
      default:
        return { outcome: 'ignored', note: `unhandled_event_type:${event.type}` };
    }
  }
}
