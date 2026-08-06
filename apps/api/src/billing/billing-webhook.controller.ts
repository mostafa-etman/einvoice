import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';
import type {
  ApplyWebhookEventResult,
  NormalizedWebhookEvent,
} from './providers/billing-provider';
import { StripeBillingProvider } from './providers/stripe.provider';
import { SubscriptionService } from './subscription.service';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Provider-signed webhook — no user JWT (specs/013-saas-layer/contracts/permissions.md). */
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: StripeBillingProvider,
    private readonly subscriptions: SubscriptionService,
    private readonly audit: AuditService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBody: Buffer | string = req.rawBody ?? JSON.stringify(req.body ?? {});

    let event: NormalizedWebhookEvent;
    try {
      event = this.provider.verifyAndParseWebhook(rawBody, signature);
    } catch (err) {
      throw new BadRequestException(
        `invalid_stripe_signature: ${err instanceof Error ? err.message : 'unknown_error'}`,
      );
    }

    const existing = await this.prisma.billingWebhookEvent.findUnique({
      where: {
        provider_providerEventId: { provider: 'stripe', providerEventId: event.providerEventId },
      },
    });
    if (existing?.processedAt) {
      // Idempotent replay — do not re-apply entitlement changes.
      return { received: true, idempotent: true };
    }

    const record =
      existing ??
      (await this.prisma.billingWebhookEvent.create({
        data: {
          provider: 'stripe',
          providerEventId: event.providerEventId,
          type: event.type,
          payloadJson: event.payload as never,
        },
      }));

    let outcome: ApplyWebhookEventResult['outcome'] = 'ignored';
    try {
      const applied = this.provider.applyWebhookEvent(event);
      outcome = applied.outcome;
      await this.applyToSubscription(applied);
    } catch {
      outcome = 'error';
    }

    await this.prisma.billingWebhookEvent.update({
      where: { id: record.id },
      data: { processedAt: new Date(), outcome },
    });

    await this.audit.write({
      action: BILLING_AUDIT_ACTIONS.WEBHOOK_PROCESSED,
      outcome: outcome === 'error' ? 'failure' : 'success',
      metadata: { type: event.type, providerEventId: event.providerEventId, outcome },
    });

    return { received: true };
  }

  private async applyToSubscription(applied: ApplyWebhookEventResult): Promise<void> {
    const update = applied.subscriptionUpdate;
    if (update?.tenantId) {
      if (update.planCode) {
        await this.subscriptions.assignPlan(update.tenantId, update.planCode, {
          status: update.status ?? 'ACTIVE',
          provider: 'stripe',
          providerSubscriptionId: update.providerSubscriptionId,
        });
      } else if (update.status === 'PAST_DUE') {
        await this.subscriptions.setStatus(update.tenantId, 'PAST_DUE', {
          graceEndsAt: addDays(new Date(), loadEnv().BILLING_GRACE_DAYS),
        });
      } else if (update.status === 'ACTIVE') {
        await this.subscriptions.setStatus(update.tenantId, 'ACTIVE', { graceEndsAt: null });
      }

      if (applied.invoice) {
        await this.subscriptions.recordInvoice(update.tenantId, applied.invoice);
      }
    }
  }
}
