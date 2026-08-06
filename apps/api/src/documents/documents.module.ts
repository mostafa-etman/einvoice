import { Module, forwardRef } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IssuedEtaService } from './issued-eta.service';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { SubmissionsModule } from '../submissions/submissions.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TenantModule,
    BillingModule,
    EtaModule,
    forwardRef(() => SubmissionsModule),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, IssuedEtaService],
  exports: [DocumentsService, IssuedEtaService],
})
export class DocumentsModule {}
