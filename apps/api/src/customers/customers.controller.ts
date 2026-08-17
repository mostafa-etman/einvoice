import {
  Body,
  Controller,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { CustomersService } from './customers.service';
import type { CustomerWriteInput } from './customer-validation';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('active') active?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customers.list(requireTenant(tenantHeader), {
      q,
      type,
      active:
        active === undefined
          ? undefined
          : active === 'true' || active === '1'
            ? true
            : active === 'false' || active === '0'
              ? false
              : undefined,
      sortBy,
      sortDir: sortDir === 'desc' ? 'desc' : 'asc',
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('search')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  search(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customers.search(
      requireTenant(tenantHeader),
      q ?? '',
      limit ? Number(limit) : 20,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.customers.get(requireTenant(tenantHeader), id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: CustomerWriteInput,
  ) {
    return this.customers.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CustomerWriteInput,
  ) {
    return this.customers.update(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body,
    );
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  deactivate(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.customers.deactivate(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
  }
}
