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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { BranchesSettingsService } from './branches.service';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCHES_VIEW)
  list(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.branches.list(requireTenant(tenantHeader));
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      isDefault?: boolean;
      etaBranchCode?: string;
      activityCode?: string;
      defaultCurrencyCode?: string;
    },
  ) {
    return this.branches.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isDefault?: boolean;
      isActive?: boolean;
      etaBranchCode?: string | null;
      activityCode?: string | null;
      defaultCurrencyCode?: string | null;
    },
  ) {
    return this.branches.update(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body,
    );
  }
}
