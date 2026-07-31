import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { ExportsService } from '../exports/exports.service';

/**
 * Bridge for ETA package-ready notifications (007).
 * Accelerates the next Get Package Requests poll only — never downloads without poll.
 */
@Controller('webhooks/eta')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EtaPackageWebhookController {
  constructor(private readonly exports: ExportsService) {}

  @Post('package-ready')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async packageReady(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Body() body: { etaRequestId?: string; requestId?: string },
  ) {
    const etaRequestId = body.etaRequestId || body.requestId;
    if (!etaRequestId) {
      return { accelerated: false, reason: 'etaRequestId required' };
    }
    return this.exports.acceleratePackagePoll(
      requireTenant(tenantHeader),
      etaRequestId,
    );
  }
}
