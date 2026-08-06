import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { BillingModule } from '../billing/billing.module';
import { AgentDevicesController } from './agent-devices.controller';
import { DeviceTokenGuard } from './device-token.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PairingService } from './pairing.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule, BillingModule],
  controllers: [DevicesController, AgentDevicesController],
  providers: [DevicesService, PairingService, DeviceTokenGuard],
  exports: [DevicesService, PairingService, DeviceTokenGuard],
})
export class DevicesModule {}
