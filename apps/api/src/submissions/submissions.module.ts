import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BillingModule } from '../billing/billing.module';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { DocumentStatusEventsService } from './document-status-events.service';
import { DocumentStatusRefreshService } from './document-status-refresh.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule, EtaModule, AnalyticsModule, BillingModule],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    DocumentStatusEventsService,
    DocumentStatusRefreshService,
  ],
  exports: [
    SubmissionsService,
    DocumentStatusEventsService,
    DocumentStatusRefreshService,
  ],
})
export class SubmissionsModule {}
