import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { EtaCredentialsService } from './eta-credentials.service';

@Controller('settings/eta-credentials')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EtaCredentialsController {
  constructor(private readonly eta: EtaCredentialsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('branchId') branchId?: string,
  ) {
    return this.eta.get(requireTenant(tenantHeader), branchId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  upsert(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      branchId?: string | null;
      clientId: string;
      clientSecret?: string;
      registrationNumber?: string;
      activityCode?: string;
      isIntermediary?: boolean;
      onBehalfOfRegistrationNumber?: string;
      onBehalfOfName?: string;
    },
  ) {
    return this.eta.upsert(requireTenant(tenantHeader), user.userId, body);
  }

  @Post('rotate-secret')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  rotate(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { clientSecret: string; branchId?: string },
  ) {
    return this.eta.rotateSecret(
      requireTenant(tenantHeader),
      user.userId,
      body.clientSecret,
      body.branchId,
    );
  }
}
