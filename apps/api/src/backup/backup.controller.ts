import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
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
import { BackupService } from './backup.service';
import { BackupRestoreService } from './backup-restore.service';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupExportService } from './backup-export.service';
import { EmptyOrgGuard } from './empty-org.guard';

@Controller('backup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BackupController {
  constructor(
    private readonly backups: BackupService,
    private readonly restores: BackupRestoreService,
    private readonly schedules: BackupScheduleService,
    private readonly exports: BackupExportService,
    private readonly emptyOrg: EmptyOrgGuard,
    @Inject('ArtifactStorage')
    private readonly artifacts: { getByKey: (key: string) => Promise<Buffer> },
  ) {}

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.BACKUP_CREATE)
  async list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('limit') limit?: string,
  ) {
    const items = await this.backups.listJobs(
      requireTenant(tenantHeader),
      limit ? Number(limit) : 20,
    );
    return { items: items.map((j) => this.backups.serializeJob(j)) };
  }

  @Post('jobs')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BACKUP_CREATE)
  async create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    const job = await this.backups.createBackup({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
    });
    return this.backups.serializeJob(job);
  }

  @Get('jobs/:id')
  @RequirePermissions(PERMISSIONS.BACKUP_CREATE)
  async get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    const job = await this.backups.getJob(requireTenant(tenantHeader), id);
    return this.backups.serializeJob(job);
  }

  @Get('jobs/:id/download')
  @RequirePermissions(PERMISSIONS.BACKUP_DOWNLOAD)
  async download(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.backups.download(
      requireTenant(tenantHeader),
      id,
      user.userId,
      (key) => this.artifacts.getByKey(key),
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${id}.bin"`);
    res.send(file.body);
  }

  @Get('schedule')
  @RequirePermissions(PERMISSIONS.BACKUP_SCHEDULE)
  getSchedule(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.schedules.get(requireTenant(tenantHeader));
  }

  @Put('schedule')
  @RequirePermissions(PERMISSIONS.BACKUP_SCHEDULE)
  upsertSchedule(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body()
    body: { cronExpression: string; timezone: string; paused?: boolean },
  ) {
    return this.schedules.upsert({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      cronExpression: body.cronExpression,
      timezone: body.timezone,
      paused: body.paused,
    });
  }

  @Post('exports')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BACKUP_EXPORT)
  createExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: { includeFiles?: boolean },
  ) {
    return this.exports.create({
      tenantId: requireTenant(tenantHeader),
      userId: user.userId,
      includeFiles: Boolean(body?.includeFiles),
    });
  }

  @Get('exports/:id')
  @RequirePermissions(PERMISSIONS.BACKUP_EXPORT)
  getExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.exports.get(requireTenant(tenantHeader), id);
  }

  @Get('exports/:id/download')
  @RequirePermissions(PERMISSIONS.BACKUP_EXPORT)
  async downloadExport(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.exports.download(
      requireTenant(tenantHeader),
      id,
      user.userId,
      (key) => this.artifacts.getByKey(key),
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="export-${id}.zip"`);
    res.send(file.body);
  }

  @Post('restores')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BACKUP_RESTORE)
  restore(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: { backupJobId: string; confirmation: string },
  ) {
    return this.restores.restoreTenantPath({
      tenantId: requireTenant(tenantHeader),
      backupJobId: body.backupJobId,
      confirmation: body.confirmation,
      actorUserId: user.userId,
    });
  }

  /** Test/ops helper: wipe operational data for same-tenant DR prep. */
  @Post('wipe-operational')
  @RequirePermissions(PERMISSIONS.BACKUP_RESTORE)
  async wipe(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
  ) {
    await this.emptyOrg.wipeOperationalData(requireTenant(tenantHeader));
    return { ok: true };
  }
}
