import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { ExportsService, type LocalExportFilters } from './exports.service';

@Controller('exports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('kind') kind?: string,
  ) {
    const items = await this.exports.listJobs(requireTenant(tenantHeader), kind);
    return { items };
  }

  @Post('local')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  createLocal(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      formats: Array<'CSV' | 'XLSX' | 'PDF' | 'JSON'>;
      filters: LocalExportFilters;
    },
  ) {
    return this.exports.createLocalExport({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      formats: body.formats,
      filters: body.filters ?? {},
    });
  }

  @Post('packages')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  createPackage(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      dateFrom: string;
      dateTo: string;
      documentTypeNames?: string[];
      statuses?: string[];
      type?: string;
      format?: string;
    },
  ) {
    return this.exports.createEtaPackage({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      ...body,
    });
  }

  @Get('jobs/:jobId')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    return this.exports.getJob(requireTenant(tenantHeader), jobId);
  }

  @Get('jobs/:jobId/download')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async download(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('jobId') jobId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.exports.download(
      requireTenant(tenantHeader),
      jobId,
      format,
      user.userId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    return res.send(file.buffer);
  }
}
