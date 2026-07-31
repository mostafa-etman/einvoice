import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EtaModule } from '../eta/eta.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaService } from '../eta/eta.service';
import { AuditService } from '../audit/audit.service';
import { PurchasesController } from './purchases.controller';
import {
  PurchasesService,
  PrismaReceivedDocumentBuyerStore,
} from './purchases.service';
import { PurchasesSyncService } from './purchases-sync.service';
import { PurchasesBuyerActionsService } from './purchases-buyer-actions.service';

@Module({
  imports: [PrismaModule, AuditModule, EtaModule, TenantModule],
  controllers: [PurchasesController],
  providers: [
    PurchasesService,
    PurchasesSyncService,
    PrismaReceivedDocumentBuyerStore,
    {
      provide: PurchasesBuyerActionsService,
      useFactory: (
        eta: EtaService,
        audit: AuditService,
        store: PrismaReceivedDocumentBuyerStore,
      ) => new PurchasesBuyerActionsService(eta, audit, store),
      inject: [EtaService, AuditService, PrismaReceivedDocumentBuyerStore],
    },
  ],
  exports: [PurchasesService, PurchasesSyncService],
})
export class PurchasesModule {}
