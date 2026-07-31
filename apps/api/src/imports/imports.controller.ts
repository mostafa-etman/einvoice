import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Body,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { ImportsService } from './imports.service';
import type { ColumnMapping } from './import-validate.service';

@Controller('imports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('templates/:documentType')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  template(
    @Param('documentType') documentType: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const fmt = (format || 'csv').toLowerCase();
    if (fmt === 'xlsx') {
      const buf = this.imports.templateXlsx(documentType);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="import-template-${documentType}.xlsx"`,
      );
      return res.send(buf);
    }
    const buf = this.imports.templateCsv(documentType);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-template-${documentType}.csv"`,
    );
    return res.send(buf);
  }

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async list(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    const items = await this.imports.listJobs(requireTenant(tenantHeader));
    return { items };
  }

  @Post('jobs')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { documentType?: string; branchId?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    return this.imports.createJob({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      documentType: body.documentType || 'I',
      branchId: body.branchId,
      fileName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Get('jobs/:jobId')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    return this.imports.getJob(requireTenant(tenantHeader), jobId);
  }

  @Put('jobs/:jobId/mapping')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  putMapping(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('jobId') jobId: string,
    @Body() body: { fields: ColumnMapping },
  ) {
    return this.imports.putMapping(
      requireTenant(tenantHeader),
      user.userId,
      jobId,
      body.fields ?? (body as unknown as ColumnMapping),
    );
  }

  @Post('jobs/:jobId/validate')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  validate(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('jobId') jobId: string,
  ) {
    return this.imports.enqueueValidate(
      requireTenant(tenantHeader),
      user.userId,
      jobId,
    );
  }

  @Get('jobs/:jobId/rows')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async rows(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('jobId') jobId: string,
    @Query('status') status?: string,
  ) {
    const items = await this.imports.listRows(
      requireTenant(tenantHeader),
      jobId,
      status,
    );
    return { items };
  }

  @Get('jobs/:jobId/error-report')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async errorReport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const buf = await this.imports.downloadErrorReport(
      requireTenant(tenantHeader),
      jobId,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-${jobId}-errors.csv"`,
    );
    return res.send(buf);
  }

  @Post('jobs/:jobId/run')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  run(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('jobId') jobId: string,
    @Body() body: { runMode: 'CREATE_ONLY' | 'CREATE_SIGN_SUBMIT' },
  ) {
    return this.imports.enqueueRun(
      requireTenant(tenantHeader),
      user.userId,
      jobId,
      body.runMode || 'CREATE_ONLY',
    );
  }
}
