import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { DevicesService } from './devices.service';
import { PairingService } from './pairing.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly pairing: PairingService,
  ) {}

  @Post('devices/pairing-codes')
  @RequirePermissions(PERMISSIONS.DEVICES_MANAGE)
  createPairingCode(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pairing.createCode(requireTenant(tenantHeader), user.userId);
  }

  @Get('devices/pairing-codes')
  @RequirePermissions(PERMISSIONS.DEVICES_VIEW)
  async listPairingCodes(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const items = await this.pairing.list(requireTenant(tenantHeader));
    return { items };
  }

  @Post('devices/pairing-codes/:id/revoke')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.DEVICES_MANAGE)
  async revokePairingCode(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.pairing.revoke(requireTenant(tenantHeader), user.userId, id);
  }

  @Get('devices')
  @RequirePermissions(PERMISSIONS.DEVICES_VIEW)
  async list(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const items = await this.devices.list(requireTenant(tenantHeader));
    return { items };
  }

  @Patch('devices/:id')
  @RequirePermissions(PERMISSIONS.DEVICES_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { label: string },
  ) {
    return this.devices.rename(requireTenant(tenantHeader), user.userId, id, body.label);
  }

  @Post('devices/:id/unpair')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.DEVICES_MANAGE)
  async unpair(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.devices.unpair(requireTenant(tenantHeader), user.userId, id);
  }
}
