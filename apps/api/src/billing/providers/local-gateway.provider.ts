import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type {
  ApplyWebhookEventResult,
  BillingCustomerRef,
  BillingProvider,
  CheckoutSessionResult,
  CreateCheckoutSessionParams,
  CreateCustomerResult,
  NormalizedWebhookEvent,
} from './billing-provider';

/**
 * Interface-complete stub for a future Egyptian local payment gateway
 * (Paymob / Fawry / Kashier — see research.md R3). Not wired for live traffic
 * in v1; kept so `BILLING_PROVIDER=local` fails loudly and clearly instead of
 * silently no-op'ing.
 */
@Injectable()
export class LocalGatewayBillingProvider implements BillingProvider {
  readonly id = 'local' as const;
  private readonly logger = new Logger(LocalGatewayBillingProvider.name);

  async createCustomer(input: BillingCustomerRef): Promise<CreateCustomerResult> {
    this.logger.warn(
      `local gateway createCustomer called for tenant ${input.tenantId} — not implemented`,
    );
    throw new NotImplementedException(
      'Local payment gateway is not implemented yet; set BILLING_PROVIDER=stripe',
    );
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult> {
    this.logger.warn(
      `local gateway createCheckoutSession called for tenant ${input.tenantId} — not implemented`,
    );
    throw new NotImplementedException(
      'Local payment gateway checkout is not implemented yet; set BILLING_PROVIDER=stripe',
    );
  }

  verifyAndParseWebhook(): NormalizedWebhookEvent {
    throw new NotImplementedException('Local payment gateway webhooks are not implemented yet');
  }

  applyWebhookEvent(): ApplyWebhookEventResult {
    throw new NotImplementedException('Local payment gateway webhooks are not implemented yet');
  }
}
