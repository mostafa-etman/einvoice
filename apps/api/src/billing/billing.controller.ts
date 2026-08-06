import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  listPlans() {
    return this.billing.listPlans();
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  getSubscription(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.billing.getSubscriptionView(requireTenant(tenantHeader));
  }

  @Get('quotas')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  getQuotas(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.billing.getQuotas(requireTenant(tenantHeader));
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  startCheckout(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { planCode: 'STARTER' | 'PRO'; successUrl?: string; cancelUrl?: string },
  ) {
    return this.billing.startCheckout(requireTenant(tenantHeader), user.userId, body);
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  changePlan(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { planCode: 'FREE' | 'STARTER' | 'PRO' },
  ) {
    return this.billing.changePlan(requireTenant(tenantHeader), user.userId, body.planCode);
  }

  @Post('enterprise-request')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  requestEnterprise(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { message?: string },
  ) {
    return this.billing.requestEnterprise(requireTenant(tenantHeader), user.userId, body?.message);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  listInvoices(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.billing.listInvoices(requireTenant(tenantHeader));
  }
}
