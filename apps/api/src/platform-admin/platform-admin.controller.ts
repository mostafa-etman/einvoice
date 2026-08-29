import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SubscriptionStatus } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PointsService } from '../billing/points.service';
import type { TenantLifecycleStatus } from '../billing/tenant-lifecycle-status';
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
    private readonly points: PointsService,
  ) {}

  @Get('tenants')
  listTenants(
    @Query('q') q?: string,
    @Query('status') status?: SubscriptionStatus,
    @Query('lifecycle') lifecycle?: TenantLifecycleStatus,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tenants.listTenants({
      q,
      status,
      lifecycle,
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
      planCode: string;
      reason?: string;
    },
  ) {
    return this.tenants.provisionTenant({ ...body, operatorUserId: user.userId });
  }

  @Get('settings')
  getSettings() {
    return this.tenants.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      autoActivateSubCompanies?: boolean;
      supportWhatsappE164?: string;
      supportWhatsappDisplay?: string;
    },
  ) {
    return this.tenants.updateSettings(user.userId, body);
  }

  @Get('plans')
  listPlans() {
    return this.tenants.listPlans();
  }

  @Post('plans')
  upsertPlan(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      code: string;
      nameEn: string;
      nameAr: string;
      descriptionEn?: string;
      descriptionAr?: string;
      documentQuota: number;
      branchQuota: number;
      deviceQuota: number;
      includedPoints: number;
      selfServe?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.tenants.upsertPlan(user.userId, body);
  }

  @Get('document-costs')
  getDocumentCosts() {
    return this.points.getEffectiveCosts();
  }

  @Put('document-costs')
  setDocumentCosts(
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ documentKind: string; points: number }> },
  ) {
    return this.points.setPlatformCosts(body.items ?? [], user.userId);
  }

  @Get('tenants/:tenantId')
  getTenant(@Param('tenantId') tenantId: string) {
    return this.tenants.getTenant(tenantId);
  }

  @Post('tenants/:tenantId/approve')
  approveTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason?: string },
  ) {
    return this.tenants.approveTenant(tenantId, user.userId, body?.reason);
  }

  @Post('tenants/:tenantId/reject')
  rejectTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { reason: string },
  ) {
    return this.tenants.rejectTenant(tenantId, user.userId, body.reason);
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
      planCode?: string;
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

  @Get('tenants/:tenantId/points')
  getPoints(@Param('tenantId') tenantId: string) {
    return this.points.snapshot(tenantId);
  }

  @Post('tenants/:tenantId/points')
  adjustPoints(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { delta: number; note?: string },
  ) {
    return this.points.adjustBalance(tenantId, Number(body.delta), user.userId, body.note);
  }

  @Put('tenants/:tenantId/document-costs')
  setTenantDocumentCosts(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { items: Array<{ documentKind: string; points: number }> },
  ) {
    return this.points.setTenantCosts(tenantId, body.items ?? [], user.userId);
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
