import { forwardRef, Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { QueuesModule } from '../queues/queues.module';
import { StorageModule } from '../storage/storage.module';
import {
  QUEUE_USAGE_ROLLUP,
  QUEUE_USAGE_EXPORT,
} from '../queues/queue-names';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { UsageEventService } from './usage-event.service';
import { UsageRollupService } from './usage-rollup.service';
import { UsageEmitService } from './usage-emit.service';
import { UsageExportService } from './usage-export.service';
import { UsageApiCallsInterceptor } from './usage-api-calls.interceptor';
import {
  UsageRollupProcessor,
  UsageExportProcessor,
  UsageRollupScheduler,
} from './usage-rollup.processor';
import { setStoragePutHook } from '../storage/storage-hooks';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    // TenantModule -> BillingModule -> AnalyticsModule -> TenantModule is a real
    // module cycle; forwardRef here (and on the BillingModule -> AnalyticsModule
    // edge) defers resolution of the reference until after all modules finish
    // loading, instead of freezing an `undefined` class into the decorator
    // metadata mid-require.
    forwardRef(() => TenantModule),
    StorageModule,
    QueuesModule,
    BullModule.registerQueue(
      { name: QUEUE_USAGE_ROLLUP },
      { name: QUEUE_USAGE_EXPORT },
    ),
  ],
  controllers: [AnalyticsController],
  providers: [
    UsageEventService,
    UsageRollupService,
    UsageEmitService,
    UsageExportService,
    AnalyticsService,
    UsageRollupProcessor,
    UsageExportProcessor,
    UsageRollupScheduler,
    {
      provide: APP_INTERCEPTOR,
      useClass: UsageApiCallsInterceptor,
    },
  ],
  exports: [
    UsageEventService,
    UsageRollupService,
    UsageEmitService,
    UsageExportService,
    AnalyticsService,
  ],
})
export class AnalyticsModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly emit: UsageEmitService) {}

  onModuleInit() {
    setStoragePutHook(async (tenantId) => {
      await this.emit.refreshStorageBytes(tenantId);
    });
  }

  onModuleDestroy() {
    setStoragePutHook(undefined);
  }
}
