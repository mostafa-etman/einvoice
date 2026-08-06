import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { TenantService } from '../tenant/tenant.service';
import { EtaService } from './eta.service';
import type { EtaConnectionStatus } from './eta-service.types';

function requireTenant(header: string | undefined): string {
  if (!header) {
    throw new BadRequestException('X-Tenant-Id header is required');
  }
  return header;
}

function publicStatus(status: EtaConnectionStatus): Omit<EtaConnectionStatus, 'accessToken'> {
  const { accessToken: _omit, ...rest } = status;
  return rest;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EtaController {
  constructor(
    private readonly eta: EtaService,
    private readonly tenants: TenantService,
  ) {}

  @Get('settings/eta/connection')
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_VIEW)
  async connection(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const status = await this.eta.getConnectionStatus(requireTenant(tenantHeader));
    return publicStatus(status);
  }

  @Post('settings/eta-credentials/test-connection')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_MANAGE)
  async testConnection(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { branchId?: string; environment?: 'SANDBOX' | 'PRODUCTION' },
  ) {
    return this.eta.testConnection(requireTenant(tenantHeader), user.userId, {
      branchId: body?.branchId,
      environment: body?.environment,
    });
  }

  @Get('settings/eta/document-types')
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_VIEW)
  async documentTypes(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Query('refresh') refresh?: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const wantRefresh = refresh === 'true' || refresh === '1';
    if (wantRefresh) {
      await this.requireManage(user.userId, tenantId);
    }
    return this.eta.listDocumentTypes(tenantId, { refresh: wantRefresh });
  }

  @Get('settings/eta/document-types/:typeId/versions')
  @RequirePermissions(PERMISSIONS.SETTINGS_ETA_VIEW)
  async versions(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('typeId') typeId: string,
    @Query('refresh') refresh?: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const wantRefresh = refresh === 'true' || refresh === '1';
    if (wantRefresh) {
      await this.requireManage(user.userId, tenantId);
    }
    return this.eta.getDocumentTypeVersions(tenantId, typeId, {
      refresh: wantRefresh,
    });
  }

  private async requireManage(userId: string, tenantId: string) {
    const ok = await this.tenants.userHasPermission(
      userId,
      tenantId,
      PERMISSIONS.SETTINGS_ETA_MANAGE,
    );
    if (!ok) {
      throw new ForbiddenException('Missing permission: settings.eta.manage');
    }
  }
}
