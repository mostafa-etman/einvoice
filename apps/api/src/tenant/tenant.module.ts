import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { TenantAdminController } from './tenant-admin.controller';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TenantController, TenantAdminController],
  providers: [TenantService, PermissionsGuard],
  exports: [TenantService, PermissionsGuard],
})
export class TenantModule {}
