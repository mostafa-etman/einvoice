import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  missingIssuerAddressFields,
  type IssuerAddress,
} from '@einvoice/eta-core';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../../billing/quota.service';
import { receiptBranchGaps } from '../receipts/receipt-readiness';
import { normalizeSyndicateLicenseNumber } from '../receipts/syndicate-license';
import { parseOptionalReceiptType } from '../receipts/receipt-type';

export type BranchAddressInput = IssuerAddress;

/** Branch column ⇄ ETA issuer address field. */
const ADDRESS_COLUMNS = {
  country: 'addressCountry',
  governate: 'addressGovernate',
  regionCity: 'addressRegionCity',
  street: 'addressStreet',
  buildingNumber: 'addressBuildingNumber',
  postalCode: 'addressPostalCode',
  floor: 'addressFloor',
  room: 'addressRoom',
  landmark: 'addressLandmark',
  additionalInformation: 'addressAdditionalInformation',
} as const;

type BranchAddressColumns = {
  [K in (typeof ADDRESS_COLUMNS)[keyof typeof ADDRESS_COLUMNS]]?: string | null;
};

export type BranchReceiptInput = {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  etaBranchCode?: string | null;
  activityCode?: string | null;
  defaultCurrencyCode?: string | null;
  address?: BranchAddressInput;
  receiptsEnabled?: boolean;
  syndicateLicenseNumber?: string | null;
  defaultReceiptType?: string | null;
};

export function branchAddressToIssuerAddress(
  branch: BranchAddressColumns,
): IssuerAddress {
  const address: IssuerAddress = {};
  for (const [field, column] of Object.entries(ADDRESS_COLUMNS)) {
    const value = branch[column];
    if (typeof value === 'string' && value.trim()) {
      address[field as keyof IssuerAddress] = value.trim();
    }
  }
  return address;
}

function addressToColumns(address: BranchAddressInput): BranchAddressColumns {
  const data: BranchAddressColumns = {};
  for (const [field, column] of Object.entries(ADDRESS_COLUMNS)) {
    const value = address[field as keyof IssuerAddress];
    if (value === undefined) continue;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    data[column] = trimmed || null;
  }
  return data;
}

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class BranchesSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async list(tenantId: string) {
    const identity = await this.tenantIdentity(tenantId);
    const branches = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return branches.map((b) => this.toDto(b, identity));
  }

  private async tenantIdentity(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { issuerType: true, syndicateLicenseNumber: true },
    });
    return {
      issuerType: tenant?.issuerType ?? 'B',
      syndicateLicenseNumber: tenant?.syndicateLicenseNumber ?? null,
    };
  }

  private toDto<T extends BranchAddressColumns & {
    etaBranchCode?: string | null;
    activityCode?: string | null;
    receiptsEnabled?: boolean;
    syndicateLicenseNumber?: string | null;
  }>(
    branch: T,
    identity: { issuerType: string; syndicateLicenseNumber: string | null },
  ) {
    const address = branchAddressToIssuerAddress(branch);
    const receiptsEnabled = Boolean(branch.receiptsEnabled);
    const gaps = receiptBranchGaps({
      receiptsEnabled,
      etaBranchCode: branch.etaBranchCode,
      activityCode: branch.activityCode,
      address,
      issuerType: identity.issuerType,
      tenantSyndicateLicense: identity.syndicateLicenseNumber,
      branchSyndicateLicense: branch.syndicateLicenseNumber,
    });
    return {
      ...branch,
      address,
      addressComplete: missingIssuerAddressFields(address).length === 0,
      receiptsReady: receiptsEnabled && gaps.length === 0,
      receiptsGaps: gaps,
    };
  }

  async create(tenantId: string, actorUserId: string, input: BranchReceiptInput & { name: string }) {
    if (input.defaultCurrencyCode) {
      await this.assertCurrency(input.defaultCurrencyCode);
    }
    this.assertCompleteAddress(input.address ?? {});

    const identity = await this.tenantIdentity(tenantId);
    const syndicate = normalizeSyndicateLicenseNumber(input.syndicateLicenseNumber);
    const etaBranchCode = emptyToNull(input.etaBranchCode) ?? null;
    const activityCode = emptyToNull(input.activityCode) ?? null;
    const receiptsEnabled = Boolean(input.receiptsEnabled);
    this.assertReceiptReady({
      receiptsEnabled,
      etaBranchCode,
      activityCode,
      address: input.address ?? {},
      issuerType: identity.issuerType,
      tenantSyndicateLicense: identity.syndicateLicenseNumber,
      branchSyndicateLicense: syndicate,
    });

    await this.quota.checkTenantWritable(tenantId);
    await this.quota.assertWithinLimits(tenantId, 'branches');

    const branch = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      if (input.isDefault) {
        await tx.branch.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const count = await tx.branch.count({ where: { tenantId } });
      return tx.branch.create({
        data: {
          tenantId,
          name: input.name.trim(),
          isDefault: input.isDefault ?? count === 0,
          etaBranchCode,
          activityCode,
          defaultCurrencyCode: input.defaultCurrencyCode,
          receiptsEnabled,
          syndicateLicenseNumber: syndicate,
          defaultReceiptType: parseOptionalReceiptType(input.defaultReceiptType),
          ...addressToColumns({
            country: 'EG',
            ...(input.address ?? {}),
          }),
        },
      });
    });

    await this.audit.write({
      action: 'settings.branch.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'branch',
      resourceId: branch.id,
      metadata: {
        name: branch.name,
        isDefault: branch.isDefault,
        receiptsEnabled: branch.receiptsEnabled,
      },
    });
    return this.toDto(branch, identity);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    branchId: string,
    input: BranchReceiptInput,
  ) {
    if (input.defaultCurrencyCode) {
      await this.assertCurrency(input.defaultCurrencyCode);
    }

    if (input.isActive === true) {
      const current = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.branch.findFirst({ where: { id: branchId, tenantId }, select: { isActive: true } }),
      );
      if (current && !current.isActive) {
        await this.quota.checkTenantWritable(tenantId);
        await this.quota.assertWithinLimits(tenantId, 'branches');
      }
    }

    const identity = await this.tenantIdentity(tenantId);

    const branch = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id: branchId, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Branch not found');
      }

      const mergedAddress = input.address
        ? { ...branchAddressToIssuerAddress(existing), ...input.address }
        : branchAddressToIssuerAddress(existing);
      if (input.address) {
        this.assertCompleteAddress(mergedAddress);
      }

      if (input.isActive === false && existing.isDefault) {
        const otherDefaults = await tx.branch.count({
          where: {
            tenantId,
            isActive: true,
            isDefault: true,
            id: { not: branchId },
          },
        });
        const otherActive = await tx.branch.count({
          where: { tenantId, isActive: true, id: { not: branchId } },
        });
        if (otherDefaults === 0 && otherActive === 0) {
          throw new BadRequestException(
            'Cannot deactivate the sole active default branch',
          );
        }
        if (otherDefaults === 0) {
          throw new BadRequestException(
            'Cannot deactivate the default branch without assigning another default',
          );
        }
      }

      if (input.isDefault === true) {
        await tx.branch.updateMany({
          where: { tenantId, isDefault: true, id: { not: branchId } },
          data: { isDefault: false },
        });
      }

      const etaBranchCode =
        input.etaBranchCode !== undefined
          ? emptyToNull(input.etaBranchCode) ?? null
          : existing.etaBranchCode;
      const activityCode =
        input.activityCode !== undefined
          ? emptyToNull(input.activityCode) ?? null
          : existing.activityCode;
      const receiptsEnabled =
        input.receiptsEnabled !== undefined
          ? Boolean(input.receiptsEnabled)
          : existing.receiptsEnabled;
      const syndicate =
        input.syndicateLicenseNumber !== undefined
          ? normalizeSyndicateLicenseNumber(input.syndicateLicenseNumber)
          : existing.syndicateLicenseNumber;

      this.assertReceiptReady({
        receiptsEnabled,
        etaBranchCode,
        activityCode,
        address: mergedAddress,
        issuerType: identity.issuerType,
        tenantSyndicateLicense: identity.syndicateLicenseNumber,
        branchSyndicateLicense: syndicate,
      });

      return tx.branch.update({
        where: { id: branchId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.etaBranchCode !== undefined ? { etaBranchCode } : {}),
          ...(input.activityCode !== undefined ? { activityCode } : {}),
          ...(input.defaultCurrencyCode !== undefined
            ? { defaultCurrencyCode: input.defaultCurrencyCode }
            : {}),
          ...(input.receiptsEnabled !== undefined ? { receiptsEnabled } : {}),
          ...(input.syndicateLicenseNumber !== undefined
            ? { syndicateLicenseNumber: syndicate }
            : {}),
          ...(input.defaultReceiptType !== undefined
            ? { defaultReceiptType: parseOptionalReceiptType(input.defaultReceiptType) }
            : {}),
          ...(input.address ? addressToColumns(input.address) : {}),
        },
      });
    });

    const action =
      input.isActive === false
        ? 'settings.branch.deactivate'
        : 'settings.branch.update';
    await this.audit.write({
      action,
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'branch',
      resourceId: branch.id,
      metadata: {
        name: branch.name,
        isDefault: branch.isDefault,
        isActive: branch.isActive,
        receiptsEnabled: branch.receiptsEnabled,
      },
    });
    return this.toDto(branch, identity);
  }

  /**
   * The issuer address is company-level: an incomplete one would make every
   * document issued from this branch fail ETA validation.
   */
  private assertCompleteAddress(address: BranchAddressInput) {
    const missing = missingIssuerAddressFields(address);
    if (missing.length) {
      throw new BadRequestException({
        code: 'ISSUER_ADDRESS_INCOMPLETE',
        message: `Branch issuer address is incomplete. Missing: ${missing.join(', ')}`,
        missing,
      });
    }
  }

  private assertReceiptReady(input: Parameters<typeof receiptBranchGaps>[0]) {
    const gaps = receiptBranchGaps(input);
    if (gaps.length) {
      throw new BadRequestException({
        code: 'RECEIPT_BRANCH_INCOMPLETE',
        message:
          'This branch is not ready for e-receipts. Fill the ETA branch ID, activity code, and address (and syndicate license if you are registered as a person). Enable B2C on your ETA taxpayer profile yourself — the platform cannot do it for you.',
        gaps,
      });
    }
  }

  private async assertCurrency(code: string) {
    const found = await this.prisma.currency.findFirst({
      where: { code, isActive: true },
    });
    if (!found) {
      throw new BadRequestException(`Unknown currency: ${code}`);
    }
  }
}
