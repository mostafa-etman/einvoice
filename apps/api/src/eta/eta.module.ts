import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { SecretsEncryptionService } from '../crypto/secrets-encryption.service';
import { EtaService } from './eta.service';
import { EtaController } from './eta.controller';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule],
  controllers: [EtaController],
  providers: [SecretsEncryptionService, EtaService],
  exports: [EtaService],
})
export class EtaModule {}
