import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { SecretsEncryptionService } from '../crypto/secrets-encryption.service';
import { BranchesController } from './branches/branches.controller';
import { BranchesSettingsService } from './branches/branches.service';
import { CurrenciesController } from './currencies/currencies.controller';
import { CurrenciesService } from './currencies/currencies.service';
import { ExchangeRatesController } from './exchange-rates/exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates/exchange-rates.service';
import { NoopExchangeRateProvider } from './exchange-rates/exchange-rate-provider';
import { EtaCredentialsController } from './eta-credentials/eta-credentials.controller';
import { EtaCredentialsService } from './eta-credentials/eta-credentials.service';
import { ItemCodesController } from './item-codes/item-codes.controller';
import { ItemCodesService } from './item-codes/item-codes.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule],
  controllers: [
    BranchesController,
    CurrenciesController,
    ExchangeRatesController,
    EtaCredentialsController,
    ItemCodesController,
  ],
  providers: [
    SecretsEncryptionService,
    BranchesSettingsService,
    CurrenciesService,
    ExchangeRatesService,
    NoopExchangeRateProvider,
    EtaCredentialsService,
    ItemCodesService,
  ],
  exports: [SecretsEncryptionService],
})
export class SettingsModule {}
