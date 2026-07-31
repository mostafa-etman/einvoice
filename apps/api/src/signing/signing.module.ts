import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { DevicesModule } from '../devices/devices.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { AgentSigningController } from './agent-signing.controller';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TenantModule,
    DevicesModule,
    SubmissionsModule,
  ],
  controllers: [SigningController, AgentSigningController],
  providers: [SigningService],
  exports: [SigningService],
})
export class SigningModule {}
