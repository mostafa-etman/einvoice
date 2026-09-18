import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { TenantAdminGuard } from './tenant-admin.guard';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, TenantAdminGuard],
  exports: [FeedbackService],
})
export class FeedbackModule {}
