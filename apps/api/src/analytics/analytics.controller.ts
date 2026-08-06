import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
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
import { AnalyticsService } from './analytics.service';
import { UsageExportService } from './usage-export.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exports: UsageExportService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  summary(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
    @Query('currencyCode') currencyCode?: string,
  ) {
    return this.analytics.getSummary({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      from,
      to,
      branchId,
      currencyCode,
    });
  }

  @Get('series')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  series(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('grain') grain: 'day' | 'month' = 'day',
    @Query('branchId') branchId?: string,
    @Query('currencyCode') currencyCode?: string,
  ) {
    return this.analytics.getSeries({
      tenantId: requireTenant(tenantHeader),
      from,
      to,
      grain: grain === 'month' ? 'month' : 'day',
      branchId,
      currencyCode,
    });
  }

  @Post('exports')
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.ANALYTICS_EXPORT)
  createExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body()
    body: {
      format: 'CSV' | 'XLSX';
      from: string;
      to: string;
      branchId?: string;
      currencyCode?: string;
      grain?: 'day' | 'month';
    },
  ) {
    return this.exports.createExport({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      format: body.format === 'XLSX' ? 'XLSX' : 'CSV',
      from: body.from,
      to: body.to,
      branchId: body.branchId,
      currencyCode: body.currencyCode,
      grain: body.grain,
    });
  }

  @Get('exports')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  listExports(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('limit') limit?: string,
  ) {
    return this.exports.listExports(
      requireTenant(tenantHeader),
      limit ? Number(limit) : 20,
    );
  }

  @Get('exports/:jobId')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  getExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    return this.exports.getExport(requireTenant(tenantHeader), jobId);
  }

  @Get('exports/:jobId/download')
  @RequirePermissions(PERMISSIONS.ANALYTICS_EXPORT)
  async downloadExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const file = await this.exports.download(
      requireTenant(tenantHeader),
      jobId,
      user.userId,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    res.send(file.buffer);
  }
}
