import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueuesModule } from '../queues/queues.module';
import { QUEUE_BACKUP } from '../queues/queue-names';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { TenantModule } from '../tenant/tenant.module';
import { BackupController } from './backup.controller';
import { BackupOperatorController } from './backup-operator.controller';
import { BackupService } from './backup.service';
import { BackupArchiveService } from './backup-archive.service';
import { BackupRestoreService } from './backup-restore.service';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupExportService } from './backup-export.service';
import { BackupRetentionService } from './backup-retention.service';
import { EmptyOrgGuard } from './empty-org.guard';
import { BackupProcessor } from './backup.processors';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    QueuesModule,
    SettingsModule,
    AuditModule,
    StorageModule,
    BullModule.registerQueue({ name: QUEUE_BACKUP }),
  ],
  controllers: [BackupController, BackupOperatorController],
  providers: [
    BackupService,
    BackupArchiveService,
    BackupRestoreService,
    BackupScheduleService,
    BackupExportService,
    BackupRetentionService,
    EmptyOrgGuard,
    BackupProcessor,
  ],
  exports: [
    BackupService,
    BackupArchiveService,
    BackupRestoreService,
    EmptyOrgGuard,
  ],
})
export class BackupModule {}
