import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { DocumentStatusEventsService } from './document-status-events.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule, EtaModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, DocumentStatusEventsService],
  exports: [SubmissionsService, DocumentStatusEventsService],
})
export class SubmissionsModule {}
