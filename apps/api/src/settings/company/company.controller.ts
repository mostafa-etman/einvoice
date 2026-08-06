import {
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { PERMISSIONS } from '@einvoice/shared';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../rbac/permissions.guard';
import { requireTenant } from '../require-tenant';
import { CompanySettingsService } from './company.service';
import { loadEnv } from '../../config/env';

@Controller('settings/company')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanySettingsController {
  constructor(private readonly company: CompanySettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_COMPANY_VIEW)
  get(@Headers('x-tenant-id') tenantHeader: string | undefined) {
    return this.company.getProfile(requireTenant(tenantHeader));
  }

  @Post('logo')
  @RequirePermissions(PERMISSIONS.SETTINGS_COMPANY_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  upload(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const max = loadEnv().TENANT_LOGO_MAX_BYTES;
    if (file.size > max) {
      throw new BadRequestException(`Logo exceeds maximum size of ${max} bytes`);
    }
    return this.company.uploadLogo(requireTenant(tenantHeader), user.userId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
    });
  }

  @Get('logo')
  @RequirePermissions(PERMISSIONS.SETTINGS_COMPANY_VIEW)
  async logo(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.company.getLogoBytes(requireTenant(tenantHeader));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.send(file.buffer);
  }

  @Delete('logo')
  @RequirePermissions(PERMISSIONS.SETTINGS_COMPANY_MANAGE)
  remove(
    @Headers('x-tenant-id') tenantHeader: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.company.removeLogo(requireTenant(tenantHeader), user.userId);
  }
}
