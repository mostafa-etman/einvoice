import {
  Body,
  Controller,
  Get,
  Headers,
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
import {
  PosDevicesService,
  type PosDeviceCreateInput,
  type PosDeviceUpdateInput,
} from './pos-devices.service';

@Controller('pos-devices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PosDevicesController {
  constructor(private readonly posDevices: PosDevicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCHES_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('branchId') branchId?: string,
  ) {
    return this.posDevices.list(requireTenant(tenantHeader), branchId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: PosDeviceCreateInput,
  ) {
    return this.posDevices.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PosDeviceUpdateInput,
  ) {
    return this.posDevices.update(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body,
    );
  }
}
