import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { ExchangeRatesService } from './exchange-rates.service';

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('base') base?: string,
    @Query('quote') quote?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.rates.list(requireTenant(tenantHeader), { base, quote, asOf });
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      baseCurrencyCode: string;
      quoteCurrencyCode: string;
      rate: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) {
    return this.rates.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      baseCurrencyCode: string;
      quoteCurrencyCode: string;
      rate: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) {
    return this.rates.update(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_MANAGE)
  async remove(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.rates.remove(requireTenant(tenantHeader), user.userId, id);
  }
}
