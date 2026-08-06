import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import type { DocumentKind, DocumentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { DocumentsService, type DocumentUpsertDto } from './documents.service';
import { IssuedEtaService } from './issued-eta.service';

@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly issuedEta: IssuedEtaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('status') status?: DocumentStatus,
    @Query('kind') kind?: DocumentKind,
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.documents.list(tenantId, { status, kind }).then((items) => ({ items }));
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  previewUnsaved(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.preview(requireTenant(tenantHeader), body);
  }

  /** Local pre-submission printable PDF from current form data (not ETA). */
  @Post('local-printout')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async localPrintoutUnsaved(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('locale') locale: string | undefined,
    @Body() body: DocumentUpsertDto,
    @Res() res: Response,
  ) {
    const result = await this.documents.localPrintoutFromDto(
      requireTenant(tenantHeader),
      body,
      locale,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return res.send(result.pdf);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Post('recalculate-totals')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  recalculateTotalsBatch(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.documents.recalculateTotalsBatch(
      requireTenant(tenantHeader),
      user.userId,
    );
  }

  @Post('cancel-selected')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  cancelSelected(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: { documentIds?: string[]; reason?: string },
  ) {
    return this.issuedEta.cancelSelected(
      requireTenant(tenantHeader),
      user.userId,
      body?.documentIds ?? [],
      body?.reason ?? '',
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.get(requireTenant(tenantHeader), id);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.update(requireTenant(tenantHeader), user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async remove(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.documents.remove(requireTenant(tenantHeader), user.userId, id);
  }

  @Post(':id/recalculate-totals')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  recalculateTotals(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documents.recalculateTotals(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
  }

  @Get(':id/eta-source')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  etaSource(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.issuedEta.getEtaSource(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
  }

  @Get(':id/printout')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async printout(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const result = await this.issuedEta.getPrintout(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.pdf);
  }

  /** Local printable PDF for a saved document (display-only; not ETA). */
  @Get(':id/local-printout')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async localPrintout(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Query('locale') locale: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.documents.localPrintoutById(
      requireTenant(tenantHeader),
      id,
      locale,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return res.send(result.pdf);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  cancel(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.issuedEta.cancel(
      requireTenant(tenantHeader),
      user.userId,
      id,
      body?.reason ?? '',
    );
  }

  @Post(':id/decline-rejection')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  declineRejection(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.issuedEta.declineRejection(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
  }

  @Post(':id/preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  previewById(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Body() body?: DocumentUpsertDto,
  ) {
    return this.documents.previewById(requireTenant(tenantHeader), id, body);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  validate(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documents.validate(requireTenant(tenantHeader), user.userId, id);
  }

  @Post(':id/mark-ready')
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  markReady(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documents.markReady(requireTenant(tenantHeader), user.userId, id);
  }
}
