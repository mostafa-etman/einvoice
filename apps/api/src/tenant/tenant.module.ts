import { forwardRef, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { TenantAdminController } from './tenant-admin.controller';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  // BillingModule needs PermissionsGuard from TenantModule (billing controllers are
  // permission-gated) and TenantModule needs SubscriptionService from BillingModule
  // (Free-plan onboarding hook) — forwardRef breaks the resulting cycle.
  imports: [PrismaModule, AuditModule, forwardRef(() => BillingModule)],
  controllers: [TenantController, TenantAdminController],
  providers: [TenantService, PermissionsGuard],
  exports: [TenantService, PermissionsGuard],
})
export class TenantModule {}
