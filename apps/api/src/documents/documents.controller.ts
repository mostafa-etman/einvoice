import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@einvoice/shared';
import type { DocumentKind, DocumentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { DocumentsService, type DocumentUpsertDto } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('status') status?: DocumentStatus,
    @Query('kind') kind?: DocumentKind,
  ) {
    const tenantId = requireTenant(tenantHeader);
    return this.documents.list(tenantId, { status, kind }).then((items) => ({ items }));
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  previewUnsaved(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.preview(requireTenant(tenantHeader), body);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.get(requireTenant(tenantHeader), id);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: DocumentUpsertDto,
  ) {
    return this.documents.update(requireTenant(tenantHeader), user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  async remove(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    await this.documents.remove(requireTenant(tenantHeader), user.userId, id);
  }

  @Post(':id/preview')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  previewById(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
    @Body() body?: DocumentUpsertDto,
  ) {
    return this.documents.previewById(requireTenant(tenantHeader), id, body);
  }

  @Post(':id/validate')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  validate(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documents.validate(requireTenant(tenantHeader), user.userId, id);
  }

  @Post(':id/mark-ready')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  markReady(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.documents.markReady(requireTenant(tenantHeader), user.userId, id);
  }
}
