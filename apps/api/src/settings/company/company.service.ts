import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { ArtifactStorage } from '../../storage/storage.module';
import { loadEnv } from '../../config/env';

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const LOGO_OBJECT_ID = 'logo';
const LOGO_KIND = 'branding';

@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async getProfile(tenantId: string) {
    const tenant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          legalName: true,
          issuerType: true,
          logoObjectKey: true,
          logoContentType: true,
          logoByteSize: true,
          logoUpdatedAt: true,
        },
      }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');

    const defaultBranch = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findFirst({
        where: { tenantId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          etaBranchCode: true,
          activityCode: true,
          addressCountry: true,
          addressGovernate: true,
          addressRegionCity: true,
          addressStreet: true,
          addressBuildingNumber: true,
          addressPostalCode: true,
          addressFloor: true,
          addressRoom: true,
          addressLandmark: true,
          addressAdditionalInformation: true,
        },
      }),
    );

    return {
      workspaceName: tenant.name,
      legalName: tenant.legalName,
      issuerType: tenant.issuerType,
      logo: tenant.logoObjectKey
        ? {
            contentType: tenant.logoContentType,
            byteSize: tenant.logoByteSize,
            updatedAt: tenant.logoUpdatedAt?.toISOString() ?? null,
          }
        : null,
      defaultBranchAddress: defaultBranch
        ? {
            branchId: defaultBranch.id,
            branchName: defaultBranch.name,
            etaBranchCode: defaultBranch.etaBranchCode,
            activityCode: defaultBranch.activityCode,
            country: defaultBranch.addressCountry,
            governate: defaultBranch.addressGovernate,
            regionCity: defaultBranch.addressRegionCity,
            street: defaultBranch.addressStreet,
            buildingNumber: defaultBranch.addressBuildingNumber,
            postalCode: defaultBranch.addressPostalCode,
            floor: defaultBranch.addressFloor,
            room: defaultBranch.addressRoom,
            landmark: defaultBranch.addressLandmark,
            additionalInformation: defaultBranch.addressAdditionalInformation,
          }
        : null,
    };
  }

  async uploadLogo(
    tenantId: string,
    actorUserId: string | undefined,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    const env = loadEnv();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(
        'Logo must be PNG, JPEG, WebP, or SVG',
      );
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    if (file.size > env.TENANT_LOGO_MAX_BYTES || file.buffer.length > env.TENANT_LOGO_MAX_BYTES) {
      throw new BadRequestException(
        `Logo exceeds maximum size of ${env.TENANT_LOGO_MAX_BYTES} bytes`,
      );
    }

    let body = file.buffer;
    let contentType = mime;
    if (mime === 'image/svg+xml') {
      try {
        body = await sharp(file.buffer, { density: 150 }).png().toBuffer();
        contentType = 'image/png';
      } catch {
        throw new BadRequestException('Could not convert SVG logo to PNG');
      }
      if (body.length > env.TENANT_LOGO_MAX_BYTES) {
        throw new BadRequestException(
          `Rasterized logo exceeds maximum size of ${env.TENANT_LOGO_MAX_BYTES} bytes`,
        );
      }
    }

    const put = await this.artifacts.put({
      tenantId,
      kind: LOGO_KIND,
      objectId: LOGO_OBJECT_ID,
      contentType,
      body,
    });

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          logoObjectKey: put.key,
          logoContentType: contentType,
          logoByteSize: body.byteLength,
          logoUpdatedAt: new Date(),
        },
      }),
    );

    await this.audit.write({
      action: 'settings.company.logo.upload',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { contentType, byteSize: body.byteLength },
    });

    return this.getProfile(tenantId);
  }

  async getLogoBytes(tenantId: string): Promise<{
    buffer: Buffer;
    contentType: string;
  }> {
    const tenant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          logoObjectKey: true,
          logoContentType: true,
        },
      }),
    );
    if (!tenant?.logoObjectKey) {
      throw new NotFoundException('No company logo uploaded');
    }
    const buffer = await this.artifacts.getByKey(tenant.logoObjectKey);
    return {
      buffer,
      contentType: tenant.logoContentType || 'application/octet-stream',
    };
  }

  async removeLogo(tenantId: string, actorUserId: string | undefined) {
    const tenant = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { logoObjectKey: true },
      }),
    );
    if (tenant?.logoObjectKey) {
      await this.artifacts.removeByKey(tenant.logoObjectKey);
    }
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: {
          logoObjectKey: null,
          logoContentType: null,
          logoByteSize: null,
          logoUpdatedAt: null,
        },
      }),
    );
    await this.audit.write({
      action: 'settings.company.logo.remove',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {},
    });
    return this.getProfile(tenantId);
  }
}
