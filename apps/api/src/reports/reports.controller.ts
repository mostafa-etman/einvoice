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
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { AuditService } from '../audit/audit.service';
import {
  parseReportFilters,
  parseReportId,
} from './report-filters';
import { ReportExportService } from './report-export.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ReportExportService,
    private readonly audit: AuditService,
  ) {}

  @Get(':reportId')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  async getReport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('reportId') reportIdParam: string,
    @Query() query: Record<string, unknown>,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const reportId = parseReportId(reportIdParam);
    const filters = parseReportFilters(query);
    const result = await this.reports.run({ tenantId, reportId, filters });
    await this.audit.write({
      tenantId,
      actorUserId: user.userId,
      action: 'reports.view',
      outcome: 'success',
      resourceType: 'report',
      resourceId: reportId,
      metadata: { from: filters.from, to: filters.to },
    });
    return result;
  }

  @Post(':reportId/export')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  async exportReport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('reportId') reportIdParam: string,
    @Body()
    body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const reportId = parseReportId(reportIdParam);
    const formatRaw = String(body.format ?? 'CSV').toUpperCase();
    const format =
      formatRaw === 'XLSX' ? 'XLSX' : formatRaw === 'PDF' ? 'PDF' : 'CSV';
    const filters = parseReportFilters(body);
    const file = await this.exports.export({
      tenantId,
      userId: user.userId,
      reportId,
      format,
      filters,
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.buffer);
  }
}
