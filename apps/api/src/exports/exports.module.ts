import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { QueuesModule } from '../queues/queues.module';
import { StorageModule } from '../storage/storage.module';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { ExportProcessor, PackagePollProcessor } from './export.processors';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TenantModule,
    EtaModule,
    QueuesModule,
    StorageModule,
  ],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExportProcessor,
    PackagePollProcessor,
  ],
  exports: [ExportsService],
})
export class ExportsModule {}
