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
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { EtaEnvironmentService } from './eta-environment.service';

@Controller('settings/eta-environment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EtaEnvironmentController {
  constructor(private readonly env: EtaEnvironmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_VIEW)
  status(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.env.getStatus(requireTenant(tenantHeader));
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  switch(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { environment: 'SANDBOX' | 'PRODUCTION' },
  ) {
    return this.env.switchEnvironment(
      requireTenant(tenantHeader),
      user.userId,
      body.environment,
    );
  }

  @Post('clear-sandbox')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  clearSandbox(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { confirmation: string },
  ) {
    return this.env.clearSandboxData(
      requireTenant(tenantHeader),
      user.userId,
      body.confirmation ?? '',
    );
  }

  @Post('go-live')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  goLive(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      clearSandboxData?: boolean;
      confirmation?: string;
    },
  ) {
    return this.env.goLive(requireTenant(tenantHeader), user.userId, {
      clearSandboxData: body.clearSandboxData,
      confirmation: body.confirmation,
    });
  }
}
