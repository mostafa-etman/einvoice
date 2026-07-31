import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ExportsModule } from '../exports/exports.module';
import { EtaPackageWebhookController } from './eta-package-webhook.controller';

@Module({
  imports: [TenantModule, ExportsModule],
  controllers: [EtaPackageWebhookController],
})
export class WebhooksModule {}
