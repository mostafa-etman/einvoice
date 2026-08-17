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
import { EtaService } from '../eta/eta.service';
import { EtaPrintoutClient } from '../eta/eta-printout.client';
import { requireTenant } from '../settings/require-tenant';
import { PurchasesService } from './purchases.service';
import { PurchasesSyncService } from './purchases-sync.service';
import { PurchasesBuyerActionsService } from './purchases-buyer-actions.service';

@Controller('purchases')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly sync: PurchasesSyncService,
    private readonly buyer: PurchasesBuyerActionsService,
    private readonly eta: EtaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASES_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('unassignedBranch') unassignedBranch?: string,
    @Query('kind') kind?: string,
    @Query('buyerDecision') buyerDecision?: string,
    @Query('reconciliationStatus') reconciliationStatus?: string,
    @Query('etaStatus') etaStatus?: string,
    @Query('seller') seller?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const allowedSort = new Set([
      'dateTimeIssued',
      'totalAmount',
      'internalId',
      'issuerName',
      'lastSyncedAt',
    ]);
    return this.purchases.list(tenantId, {
      from,
      to,
      branchId,
      unassignedBranch: unassignedBranch === 'true' || unassignedBranch === '1',
      kind,
      buyerDecision,
      reconciliationStatus,
      etaStatus,
      seller,
      q,
      cursor,
      limit: limit ? Number(limit) : undefined,
      sortBy: allowedSort.has(sortBy ?? '')
        ? (sortBy as
            | 'dateTimeIssued'
            | 'totalAmount'
            | 'internalId'
            | 'issuerName'
            | 'lastSyncedAt')
        : undefined,
      sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
    });
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
  async syncNow(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body?: { from?: string; to?: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    const run = await this.sync.startManualSync(
      tenantId,
      user.userId,
      body?.from || body?.to ? { from: body.from, to: body.to } : undefined,
    );
    return run;
  }

  @Get('sync/latest')
  @RequirePermissions(PERMISSIONS.PURCHASES_VIEW)
  latestSync(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.sync.latestSync(requireTenant(tenantHeader));
  }

  /** Cancel a stuck PENDING/RUNNING purchases sync so a new one can start. */
  @Post('sync/reset')
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
  async resetSync(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.sync.resetStuckSync(tenantId, user.userId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_VIEW)
  async get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const detail = await this.purchases.get(requireTenant(tenantHeader), id);
    if (!detail) throw new NotFoundException('Purchase not found');
    return detail;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
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
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
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
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
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
  @RequirePermissions(PERMISSIONS.PURCHASES_MANAGE)
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
  @RequirePermissions(PERMISSIONS.PURCHASES_VIEW)
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
    const printout = new EtaPrintoutClient(
      await this.eta.getApiBaseUrl(tenantId),
    );
    const pdf = await printout.getPdf(token, detail.documentUuid);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="purchase-${detail.documentUuid}.pdf"`,
    );
    res.send(pdf);
  }

  @Get(':id/local-printout')
  @RequirePermissions(PERMISSIONS.PURCHASES_VIEW)
  async localPrintout(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Query('locale') locale: string | undefined,
    @Res() res: Response,
  ) {
    const tenantId = requireTenant(tenantHeader);
    try {
      const { pdf, filename } = await this.purchases.localPrintout(
        tenantId,
        id,
        locale,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 404) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}
