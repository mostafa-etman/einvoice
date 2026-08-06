import {
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { InvoiceNumberCharset, InvoiceNumberScope } from '@prisma/client';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { InvoiceNumberingService } from './invoice-numbering.service';

@Controller('settings/invoice-numbering')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvoiceNumberingController {
  constructor(private readonly numbering: InvoiceNumberingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_NUMBERING_VIEW)
  get(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.numbering.get(requireTenant(tenantHeader));
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_NUMBERING_MANAGE)
  upsert(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      prefix: string;
      padWidth: number;
      startingNumber: number;
      charset: InvoiceNumberCharset;
      scope: InvoiceNumberScope;
    },
  ) {
    return this.numbering.upsert(requireTenant(tenantHeader), user.userId, body);
  }

  @Get('next')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async next(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('branchId') branchId?: string,
    @Query('kind') kind?: string,
    @Query('allocate') allocate?: string,
  ) {
    const tenantId = requireTenant(tenantHeader);
    const shouldAllocate = allocate === '1' || allocate === 'true';
    if (shouldAllocate) {
      return this.numbering.allocateNext(tenantId, { branchId, kind });
    }
    const internalId = await this.numbering.peekNext(tenantId, {
      branchId,
      kind,
    });
    return { internalId };
  }
}
