import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { TenantService } from '../tenant/tenant.service';

function requireTenant(header: string | undefined): string {
  if (!header) {
    throw new BadRequestException('X-Tenant-Id header is required');
  }
  return header;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantAdminController {
  constructor(private readonly tenants: TenantService) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  async listRoles(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const tenantId = requireTenant(tenantHeader);
    const roles = await this.tenants.listRoles(tenantId);
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      permissions: r.rolePermissions.map((rp) => rp.permission.code),
    }));
  }

  @Get('members')
  @RequirePermissions(PERMISSIONS.MEMBERS_VIEW)
  async listMembers(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const tenantId = requireTenant(tenantHeader);
    const members = await this.tenants.listMembers(tenantId);
    return members.map((m) => ({
      id: m.id,
      user: { id: m.user.id, email: m.user.email, name: m.user.name },
      role: { id: m.role.id, name: m.role.name },
    }));
  }

  @Post('members')
  @RequirePermissions(PERMISSIONS.MEMBERS_MANAGE)
  addMember(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { email: string; roleId: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.tenants.addMember(tenantId, user.userId, body.email, body.roleId);
  }

  @Patch('members')
  @RequirePermissions(PERMISSIONS.MEMBERS_MANAGE)
  updateMember(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { membershipId: string; roleId: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.tenants.updateMemberRole(
      tenantId,
      user.userId,
      body.membershipId,
      body.roleId,
    );
  }
}
