import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { loadEnv } from '../config/env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { TenantService } from './tenant.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantController {
  private readonly env = loadEnv();

  constructor(
    private readonly tenants: TenantService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string },
    @Req() req: Request,
  ) {
    if (user.impersonation) {
      throw new ForbiddenException('Cannot create a company while impersonating');
    }
    const tenant = await this.tenants.createTenant(user.userId, body.name);
    const raw = req.cookies?.[this.env.REFRESH_COOKIE_NAME] as string | undefined;
    const switched = await this.auth.switchTenant(user.userId, tenant.id, raw);
    return {
      id: tenant.id,
      name: tenant.name,
      accessToken: switched.accessToken,
      expiresIn: switched.expiresIn,
      activeTenantId: switched.activeTenantId,
    };
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.tenants.listMyTenants(user.userId);
  }

  /** Bind this session to a company the caller belongs to; returns a new access token with `tid`. */
  @Post('switch')
  @HttpCode(200)
  async switchTenant(
    @CurrentUser() user: AuthUser,
    @Body() body: { tenantId: string },
    @Req() req: Request,
  ) {
    if (user.impersonation) {
      throw new ForbiddenException('Cannot switch company while impersonating');
    }
    if (!body?.tenantId) {
      throw new ForbiddenException('tenantId is required');
    }
    const raw = req.cookies?.[this.env.REFRESH_COOKIE_NAME] as string | undefined;
    const switched = await this.auth.switchTenant(user.userId, body.tenantId, raw);
    const memberships = await this.tenants.listMyTenants(user.userId);
    const current = memberships.find((m) => m.tenant.id === switched.activeTenantId);
    return {
      accessToken: switched.accessToken,
      expiresIn: switched.expiresIn,
      activeTenantId: switched.activeTenantId,
      tenant: current?.tenant ?? { id: switched.activeTenantId, name: '' },
      role: current?.role ?? null,
    };
  }
}
