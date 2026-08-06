import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { ImpersonationGuard } from './impersonation.guard';
import { ImpersonationService } from './impersonation.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TenantLifecycleService } from './tenant-lifecycle.service';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, TenantModule, BillingModule],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminGuard,
    ImpersonationService,
    TenantLifecycleService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ImpersonationGuard,
    },
  ],
  exports: [ImpersonationService],
})
export class PlatformAdminModule {}
