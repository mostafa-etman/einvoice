import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';
import { RlsRoleGuard } from './rls-role.guard';

@Module({
  providers: [PrismaService, TenantPrismaService, RlsRoleGuard],
  exports: [PrismaService, TenantPrismaService],
})
export class PrismaModule {}
