import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { DocumentsModule } from '../documents/documents.module';
import { SigningModule } from '../signing/signing.module';
import { QueuesModule } from '../queues/queues.module';
import { StorageModule } from '../storage/storage.module';
import { ImportParseService } from './import-parse.service';
import { ImportValidateService } from './import-validate.service';
import { ImportErrorReportService } from './import-error-report.service';
import { ImportRunService } from './import-run.service';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { ImportProcessor } from './import.processor';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TenantModule,
    DocumentsModule,
    SigningModule,
    QueuesModule,
    StorageModule,
  ],
  controllers: [ImportsController],
  providers: [
    ImportParseService,
    ImportValidateService,
    ImportErrorReportService,
    ImportRunService,
    ImportsService,
    ImportProcessor,
  ],
  exports: [ImportsService, ImportParseService, ImportValidateService],
})
export class ImportsModule {}
