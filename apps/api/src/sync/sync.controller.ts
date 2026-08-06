import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import {
  SyncService,
  type DraftSyncBody,
} from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Put('drafts')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async upsertDraft(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('if-match-revision') ifMatchRevisionHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: DraftSyncBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const ifMatch =
      ifMatchRevisionHeader !== undefined && ifMatchRevisionHeader !== ''
        ? Number(ifMatchRevisionHeader)
        : undefined;
    if (ifMatch !== undefined && Number.isNaN(ifMatch)) {
      res.status(400);
      return { message: 'If-Match-Revision must be an integer' };
    }
    const { statusCode, result } = await this.sync.upsertDraft(
      tenantId,
      user.userId,
      idempotencyKey,
      ifMatch,
      body,
    );
    res.status(statusCode);
    return result;
  }

  @Post('conflicts/:conflictId/resolve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  resolveConflict(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('conflictId') conflictId: string,
    @Body()
    body: {
      resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGED';
      mergedPayload?: DraftSyncBody;
    },
  ) {
    return this.sync.resolveConflict(
      requireTenant(tenantHeader),
      user.userId,
      conflictId,
      body.resolution,
      body.mergedPayload,
    );
  }
}
