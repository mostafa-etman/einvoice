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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../rbac/permissions.guard';
import { requireTenant } from '../settings/require-tenant';
import { ReceiptsService, type ReceiptUpsertDto } from './receipts.service';

@Controller('receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  list(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Query('posDeviceId') posDeviceId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.receipts.list(requireTenant(tenantHeader), {
      posDeviceId,
      branchId,
    });
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  preview(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Body() body: ReceiptUpsertDto,
  ) {
    return this.receipts.preview(requireTenant(tenantHeader), body);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  create(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Body() body: ReceiptUpsertDto,
  ) {
    return this.receipts.create(requireTenant(tenantHeader), user.userId, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_VIEW)
  get(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Param('id') id: string,
  ) {
    return this.receipts.get(requireTenant(tenantHeader), id);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  update(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReceiptUpsertDto,
  ) {
    return this.receipts.update(requireTenant(tenantHeader), user.userId, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENTS_MANAGE)
  remove(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.receipts.remove(requireTenant(tenantHeader), user.userId, id);
  }
}
