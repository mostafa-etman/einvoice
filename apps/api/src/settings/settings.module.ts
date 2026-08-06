import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { EtaModule } from '../eta/eta.module';
import { BillingModule } from '../billing/billing.module';
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
import { EtaEnvironmentController } from './eta-environment/eta-environment.controller';
import { EtaEnvironmentService } from './eta-environment/eta-environment.service';
import { ItemCodesController } from './item-codes/item-codes.controller';
import { ItemCodesService } from './item-codes/item-codes.service';
import { ItemCodesSyncService } from './item-codes/item-codes-sync.service';
import { InvoiceNumberingController } from './invoice-numbering/invoice-numbering.controller';
import { InvoiceNumberingService } from './invoice-numbering/invoice-numbering.service';
import { CompanySettingsController } from './company/company.controller';
import { CompanySettingsService } from './company/company.service';

@Module({
  imports: [PrismaModule, AuditModule, TenantModule, EtaModule, BillingModule],
  controllers: [
    BranchesController,
    CurrenciesController,
    ExchangeRatesController,
    EtaCredentialsController,
    EtaEnvironmentController,
    ItemCodesController,
    InvoiceNumberingController,
    CompanySettingsController,
  ],
  providers: [
    SecretsEncryptionService,
    BranchesSettingsService,
    CurrenciesService,
    ExchangeRatesService,
    NoopExchangeRateProvider,
    EtaCredentialsService,
    EtaEnvironmentService,
    ItemCodesService,
    ItemCodesSyncService,
    InvoiceNumberingService,
    CompanySettingsService,
  ],
  exports: [SecretsEncryptionService, InvoiceNumberingService, CompanySettingsService],
})
export class SettingsModule {}
