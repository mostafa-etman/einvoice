import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { CurrenciesService } from './currencies.service';

@Controller('currencies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get('catalog')
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_VIEW)
  catalog() {
    return this.currencies.listCatalog();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_VIEW)
  list(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.currencies.listTenant(requireTenant(tenantHeader));
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_MANAGE)
  enable(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { currencyCode: string; isDefault?: boolean },
  ) {
    return this.currencies.enable(
      requireTenant(tenantHeader),
      user.userId,
      body.currencyCode,
      body.isDefault,
    );
  }

  @Put('default')
  @RequirePermissions(PERMISSIONS.SETTINGS_CURRENCIES_MANAGE)
  setDefault(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { currencyCode: string },
  ) {
    return this.currencies.setDefault(
      requireTenant(tenantHeader),
      user.userId,
      body.currencyCode,
    );
  }
}
