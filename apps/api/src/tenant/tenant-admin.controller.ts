import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSION_GROUPS, PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { RolesService } from '../rbac/roles.service';
import { requireSessionTenant } from '../settings/require-tenant';
import { TenantService } from './tenant.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantAdminController {
  constructor(
    private readonly tenants: TenantService,
    private readonly roles: RolesService,
  ) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  async permissionCatalog(@CurrentUser() user: AuthUser) {
    const tenantId = requireSessionTenant(user);
    const canManage = await this.tenants.userHasPermission(
      user.userId,
      tenantId,
      PERMISSIONS.ROLES_MANAGE,
    );
    return {
      canManage,
      codes: Object.values(PERMISSIONS),
      groups: PERMISSION_GROUPS.map((g) => ({ id: g.id, codes: g.codes })),
    };
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  listRoles(@CurrentUser() user: AuthUser) {
    return this.roles.list(requireSessionTenant(user));
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  createRole(
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; permissions?: string[] },
  ) {
    return this.roles.create(requireSessionTenant(user), user.userId, {
      name: body.name ?? '',
      permissions: body.permissions,
    });
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { name?: string; permissions?: string[] },
  ) {
    return this.roles.update(requireSessionTenant(user), user.userId, id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reassignToRoleId') reassignToRoleId?: string,
  ) {
    return this.roles.remove(
      requireSessionTenant(user),
      user.userId,
      id,
      reassignToRoleId,
    );
  }

  @Get('members')
  @RequirePermissions(PERMISSIONS.MEMBERS_VIEW)
  async listMembers(@CurrentUser() user: AuthUser) {
    const tenantId = requireSessionTenant(user);
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
    @CurrentUser() user: AuthUser,
    @Body() body: { email: string; roleId: string },
  ) {
    const tenantId = requireSessionTenant(user);
    return this.tenants.addMember(tenantId, user.userId, body.email, body.roleId);
  }

  @Patch('members')
  @RequirePermissions(PERMISSIONS.MEMBERS_MANAGE)
  updateMember(
    @CurrentUser() user: AuthUser,
    @Body() body: { membershipId: string; roleId: string },
  ) {
    const tenantId = requireSessionTenant(user);
    return this.roles.updateMemberRole(
      tenantId,
      user.userId,
      body.membershipId,
      body.roleId,
    );
  }
}
