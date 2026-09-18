import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { ReceiptSubmitService } from './receipt-submit.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule, EtaModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptSubmitService],
  exports: [ReceiptsService, ReceiptSubmitService],
})
export class ReceiptsModule {}
