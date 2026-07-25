import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { SettingsModule } from './settings/settings.module';
import { EtaModule } from './eta/eta.module';
import { DocumentsModule } from './documents/documents.module';
import { DevicesModule } from './devices/devices.module';
import { SigningModule } from './signing/signing.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    TenantModule,
    SettingsModule,
    EtaModule,
    DocumentsModule,
    DevicesModule,
    SigningModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
