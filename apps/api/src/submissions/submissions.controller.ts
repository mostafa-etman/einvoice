import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { SubmissionsService } from './submissions.service';
import { DocumentStatusRefreshService } from './document-status-refresh.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly statusRefresh: DocumentStatusRefreshService,
  ) {}

  @Post('submissions')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  createSubmission(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { documentIds?: string[] },
  ) {
    const tenantId = requireTenant(tenantHeader);
    const ids = body?.documentIds ?? [];
    const key =
      idempotencyKey && idempotencyKey.length >= 8
        ? idempotencyKey
        : `batch-manual:${ids.slice().sort().join(',').slice(0, 100)}:${Date.now()}`;
    return this.submissions.submitSelected(tenantId, user.userId, ids, key);
  }

  @Post('documents/:id/submit')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  submitDocument(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const key =
      idempotencyKey && idempotencyKey.length >= 8
        ? idempotencyKey
        : `manual-stable:${id}`;
    return this.submissions.submitSingleDocument(
      tenantId,
      user.userId,
      id,
      key,
    );
  }

  @Post('documents/:id/submit/reset-cooldown')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  resetCooldown(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.submissions.resetSubmitCooldown(
      requireTenant(tenantHeader),
      id,
      user.userId,
    );
  }

  @Post('documents/refresh-status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  refreshMany(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: { documentIds?: string[]; pendingOnly?: boolean },
  ) {
    return this.statusRefresh.refreshMany(
      requireTenant(tenantHeader),
      user.userId,
      {
        documentIds: body?.documentIds,
        pendingOnly: Boolean(body?.pendingOnly),
      },
    );
  }

  @Post('documents/:id/refresh-status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  refreshOne(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.statusRefresh.refreshOne(
      requireTenant(tenantHeader),
      user.userId,
      id,
    );
  }

  @Get('submissions/:id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  getSubmission(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.submissions.getDetail(requireTenant(tenantHeader), id);
  }
}
