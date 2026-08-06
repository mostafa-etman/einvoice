import { forwardRef, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueuesModule } from '../queues/queues.module';
import { TenantModule } from '../tenant/tenant.module';
import { loadEnv } from '../config/env';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingPastDueProcessor, BillingPastDueScheduler } from './billing-past-due.processor';
import { BillingService } from './billing.service';
import { BILLING_PROVIDER, type BillingProvider } from './providers/billing-provider';
import { LocalGatewayBillingProvider } from './providers/local-gateway.provider';
import { StripeBillingProvider } from './providers/stripe.provider';
import { QuotaService } from './quota.service';
import { SubscriptionService } from './subscription.service';
import { TenantAccessGuard, TenantAccessService } from './tenant-access.guard';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    QueuesModule,
    // Both edges of the TenantModule <-> BillingModule <-> AnalyticsModule cycle
    // need forwardRef — see the comment in analytics.module.ts.
    forwardRef(() => AnalyticsModule),
    forwardRef(() => TenantModule),
  ],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    QuotaService,
    SubscriptionService,
    TenantAccessService,
    BillingService,
    StripeBillingProvider,
    LocalGatewayBillingProvider,
    BillingPastDueProcessor,
    BillingPastDueScheduler,
    {
      provide: BILLING_PROVIDER,
      useFactory: (
        stripe: StripeBillingProvider,
        local: LocalGatewayBillingProvider,
      ): BillingProvider => (loadEnv().BILLING_PROVIDER === 'local' ? local : stripe),
      inject: [StripeBillingProvider, LocalGatewayBillingProvider],
    },
    {
      provide: APP_GUARD,
      useClass: TenantAccessGuard,
    },
  ],
  exports: [QuotaService, SubscriptionService, TenantAccessService, StripeBillingProvider],
})
export class BillingModule {}
