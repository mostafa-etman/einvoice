import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import type { SignatureJobStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { SigningService } from './signing.service';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  @Post('documents/:id/send-for-signature')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  sendForSignature(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.signing.sendForSignature(requireTenant(tenantHeader), user.userId, id);
  }

  @Get('signing/jobs')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  async listJobs(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('status') status?: SignatureJobStatus,
  ) {
    const items = await this.signing.listJobs(requireTenant(tenantHeader), status);
    return { items };
  }
}
