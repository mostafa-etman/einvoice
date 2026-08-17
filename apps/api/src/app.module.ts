import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { TenantContextInterceptor } from './tenant/tenant-context.interceptor';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { SettingsModule } from './settings/settings.module';
import { EtaModule } from './eta/eta.module';
import { DocumentsModule } from './documents/documents.module';
import { DevicesModule } from './devices/devices.module';
import { SigningModule } from './signing/signing.module';
import { EtaCodesModule } from './eta-codes/eta-codes.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ImportsModule } from './imports/imports.module';
import { ExportsModule } from './exports/exports.module';
import { QueuesModule } from './queues/queues.module';
import { StorageModule } from './storage/storage.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SyncModule } from './sync/sync.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { BackupModule } from './backup/backup.module';
import { BillingModule } from './billing/billing.module';
import { EmailModule } from './email/email.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    TenantModule,
    SettingsModule,
    EtaModule,
    DocumentsModule,
    DevicesModule,
    SigningModule,
    SubmissionsModule,
    EtaCodesModule,
    PurchasesModule,
    StorageModule,
    ImportsModule,
    ExportsModule,
    QueuesModule,
    WebhooksModule,
    SyncModule,
    AnalyticsModule,
    ReportsModule,
    BackupModule,
    BillingModule,
    EmailModule,
    PlatformAdminModule,
    CustomersModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
