import { forwardRef, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RolesService } from '../rbac/roles.service';
import { TenantAdminController } from './tenant-admin.controller';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantContextService } from './tenant-context.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  // BillingModule needs PermissionsGuard from TenantModule (billing controllers are
  // permission-gated) and TenantModule needs SubscriptionService from BillingModule
  // (Free-plan onboarding hook) — forwardRef breaks the resulting cycle.
  imports: [PrismaModule, AuditModule, AuthModule, forwardRef(() => BillingModule)],
  controllers: [TenantController, TenantAdminController],
  providers: [
    TenantService,
    RolesService,
    TenantContextService,
    TenantContextInterceptor,
    PermissionsGuard,
  ],
  exports: [
    TenantService,
    RolesService,
    PermissionsGuard,
    TenantContextService,
    TenantContextInterceptor,
  ],
})
export class TenantModule {}
