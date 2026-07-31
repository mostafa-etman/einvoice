import {
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

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

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

  @Get('submissions/:id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  getSubmission(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.submissions.getDetail(requireTenant(tenantHeader), id);
  }
}
