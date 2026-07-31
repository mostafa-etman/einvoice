import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard';
import { loadEnv } from '../config/env';
import { EtaService } from '../eta/eta.service';
import { EtaPrintoutClient } from '../eta/eta-printout.client';
import { requireTenant } from '../settings/require-tenant';
import { PurchasesService } from './purchases.service';
import { PurchasesSyncService } from './purchases-sync.service';
import { PurchasesBuyerActionsService } from './purchases-buyer-actions.service';

@Controller('purchases')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasesController {
  private printoutClient: EtaPrintoutClient;

  constructor(
    private readonly purchases: PurchasesService,
    private readonly sync: PurchasesSyncService,
    private readonly buyer: PurchasesBuyerActionsService,
    private readonly eta: EtaService,
  ) {
    this.printoutClient = new EtaPrintoutClient(loadEnv().ETA_API_BASE_URL);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('unassignedBranch') unassignedBranch?: string,
    @Query('kind') kind?: string,
    @Query('buyerDecision') buyerDecision?: string,
    @Query('reconciliationStatus') reconciliationStatus?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.purchases.list(tenantId, {
      from,
      to,
      branchId,
      unassignedBranch: unassignedBranch === 'true' || unassignedBranch === '1',
      kind,
      buyerDecision,
      reconciliationStatus,
      q,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async syncNow(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    const run = await this.sync.startManualSync(tenantId, user.userId);
    return run;
  }

  @Get('sync/latest')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  latestSync(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.sync.latestSync(requireTenant(tenantHeader));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const detail = await this.purchases.get(requireTenant(tenantHeader), id);
    if (!detail) throw new NotFoundException('Purchase not found');
    return detail;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async patch(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      branchId?: string | null;
      reconciliationStatus?: string;
      reconciliationNote?: string | null;
    },
  ) {
    const tenantId = requireTenant(tenantHeader);
    const existing = await this.purchases.get(tenantId, id);
    if (!existing) throw new NotFoundException('Purchase not found');
    try {
      return await this.purchases.patch(tenantId, id, body);
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 400) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  @Post(':id/accept')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async accept(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    await this.buyer.accept(tenantId, user.userId, id);
    return this.purchases.get(tenantId, id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async reject(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    await this.buyer.reject(tenantId, user.userId, id, body.reason ?? '');
    return this.purchases.get(tenantId, id);
  }

  @Post(':id/decline-cancelation')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async declineCancelation(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    await this.buyer.declineCancelation(tenantId, user.userId, id);
    return this.purchases.get(tenantId, id);
  }

  @Get(':id/printout')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async printout(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const detail = await this.purchases.get(tenantId, id);
    if (!detail?.documentUuid) {
      throw new NotFoundException('Purchase or printout identity unavailable');
    }
    const token = await this.eta.getAccessToken(tenantId);
    const pdf = await this.printoutClient.getPdf(token, detail.documentUuid);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="purchase-${detail.documentUuid}.pdf"`,
    );
    res.send(pdf);
  }
}
