import { Injectable, Logger } from '@nestjs/common';
import type {
  ApplyWebhookEventResult,
  BillingCustomerRef,
  BillingProvider,
  CheckoutSessionResult,
  CreateCheckoutSessionParams,
  CreateCustomerResult,
  NormalizedWebhookEvent,
} from './billing-provider';
import { PaymentProviderDisabledError } from './stripe-config';

/**
 * Interface-complete stub for a future Egyptian local payment gateway
 * (Paymob / Fawry / Kashier — see research.md R3). Online charges are not
 * collected here; tenant upgrades go through WhatsApp + super-admin.
 */
@Injectable()
export class LocalGatewayBillingProvider implements BillingProvider {
  readonly id = 'local' as const;
  private readonly logger = new Logger(LocalGatewayBillingProvider.name);

  async createCustomer(input: BillingCustomerRef): Promise<CreateCustomerResult> {
    this.logger.warn(
      `local gateway createCustomer called for tenant ${input.tenantId} — online checkout disabled`,
    );
    throw new PaymentProviderDisabledError(
      'Online checkout is disabled; use the WhatsApp activation flow',
    );
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionParams,
  ): Promise<CheckoutSessionResult> {
    this.logger.warn(
      `local gateway createCheckoutSession called for tenant ${input.tenantId} — online checkout disabled`,
    );
    throw new PaymentProviderDisabledError(
      'Online checkout is disabled; use the WhatsApp activation flow',
    );
  }

  verifyAndParseWebhook(): NormalizedWebhookEvent {
    throw new PaymentProviderDisabledError('Local payment gateway webhooks are not implemented yet');
  }

  applyWebhookEvent(): ApplyWebhookEventResult {
    throw new PaymentProviderDisabledError('Local payment gateway webhooks are not implemented yet');
  }
}
