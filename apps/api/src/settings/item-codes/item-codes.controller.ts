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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { ItemCodesService } from './item-codes.service';
import { ItemCodesSyncService } from './item-codes-sync.service';

@Controller('item-codes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemCodesController {
  constructor(
    private readonly items: ItemCodesService,
    private readonly sync: ItemCodesSyncService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_ITEM_CODES_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('active') active?: string,
  ) {
    return this.items.list(requireTenant(tenantHeader), {
      q,
      type,
      active:
        active === undefined
          ? undefined
          : active === 'true' || active === '1',
    });
  }

  @Post('sync')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.SETTINGS_ITEM_CODES_MANAGE)
  startSync(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sync.startSync(requireTenant(tenantHeader), user.userId);
  }

  @Get('sync/latest')
  @RequirePermissions(PERMISSIONS.SETTINGS_ITEM_CODES_VIEW)
  latestSync(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.sync.latestSync(requireTenant(tenantHeader));
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.SETTINGS_ITEM_CODES_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { type: string; code: string; description: string },
  ) {
    return this.items.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_ITEM_CODES_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { description?: string; isActive?: boolean },
  ) {
    return this.items.update(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body,
    );
  }
}
