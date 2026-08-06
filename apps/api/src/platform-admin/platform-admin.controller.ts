import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { PlanCode, SubscriptionStatus } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImpersonationService } from './impersonation.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TenantLifecycleService } from './tenant-lifecycle.service';

/** Super-admin console — JwtAuthGuard + PlatformAdminGuard (isPlatformOperator), NOT tenant RBAC. */
@Controller('platform-admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAdminController {
  constructor(
    private readonly tenants: TenantLifecycleService,
    private readonly impersonation: ImpersonationService,
  ) {}

  @Get('tenants')
  listTenants(
    @Query('q') q?: string,
    @Query('status') status?: SubscriptionStatus,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tenants.listTenants({
      q,
      status,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('tenants')
  @HttpCode(201)
  provisionTenant(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      name: string;
      ownerEmail: string;
      ownerName?: string;
      planCode: PlanCode;
      reason?: string;
    },
  ) {
    return this.tenants.provisionTenant({ ...body, operatorUserId: user.userId });
  }

  @Get('tenants/:tenantId')
  getTenant(@Param('tenantId') tenantId: string) {
    return this.tenants.getTenant(tenantId);
  }

  @Post('tenants/:tenantId/suspend')
  suspendTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    return this.tenants.suspendTenant(tenantId, body.reason, user.userId);
  }

  @Post('tenants/:tenantId/activate')
  activateTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason?: string },
  ) {
    return this.tenants.activateTenant(tenantId, user.userId, body?.reason);
  }

  @Post('tenants/:tenantId/plan')
  assignPlan(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      planCode?: PlanCode;
      documentQuota?: number | null;
      branchQuota?: number | null;
      deviceQuota?: number | null;
      reason: string;
    },
  ) {
    return this.tenants.assignPlan(tenantId, { ...body, operatorUserId: user.userId });
  }

  @Get('tenants/:tenantId/usage')
  getUsage(@Param('tenantId') tenantId: string) {
    return this.tenants.getUsage(tenantId);
  }

  @Post('impersonation')
  @HttpCode(201)
  async startImpersonation(
    @CurrentUser() user: AuthUser,
    @Body() body: { tenantId: string; targetUserId: string; reason: string; ttlMinutes?: number },
  ) {
    const { session, accessToken } = await this.impersonation.start({
      operatorUserId: user.userId,
      tenantId: body.tenantId,
      targetUserId: body.targetUserId,
      reason: body.reason,
      ttlMinutes: body.ttlMinutes,
    });
    return this.toSessionView(session, accessToken);
  }

  @Post('impersonation/:sessionId/break-glass')
  async breakGlass(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    const { session, accessToken } = await this.impersonation.breakGlass(
      sessionId,
      user.userId,
      body.reason,
    );
    return this.toSessionView(session, accessToken);
  }

  @Post('impersonation/:sessionId/end')
  endImpersonation(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    return this.impersonation.end(sessionId, user.userId);
  }

  private toSessionView(
    session: {
      id: string;
      tenantId: string;
      targetUserId: string;
      mode: string;
      reason: string;
      expiresAt: Date;
    },
    accessToken: string,
  ) {
    return {
      id: session.id,
      tenantId: session.tenantId,
      targetUserId: session.targetUserId,
      mode: session.mode,
      reason: session.reason,
      expiresAt: session.expiresAt.toISOString(),
      accessToken,
    };
  }
}
