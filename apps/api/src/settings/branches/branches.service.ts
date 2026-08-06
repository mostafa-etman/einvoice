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

@Injectable()
export class BranchesSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async list(tenantId: string) {
    const branches = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return branches.map((b) => this.toDto(b));
  }

  private toDto<T extends BranchAddressColumns>(branch: T) {
    const address = branchAddressToIssuerAddress(branch);
    return {
      ...branch,
      address,
      addressComplete: missingIssuerAddressFields(address).length === 0,
    };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: {
      name: string;
      isDefault?: boolean;
      etaBranchCode?: string;
      activityCode?: string;
      defaultCurrencyCode?: string;
      address?: BranchAddressInput;
    },
  ) {
    if (input.defaultCurrencyCode) {
      await this.assertCurrency(input.defaultCurrencyCode);
    }
    this.assertCompleteAddress(input.address ?? {});

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
          etaBranchCode: input.etaBranchCode,
          activityCode: input.activityCode,
          defaultCurrencyCode: input.defaultCurrencyCode,
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
      metadata: { name: branch.name, isDefault: branch.isDefault },
    });
    return this.toDto(branch);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    branchId: string,
    input: {
      name?: string;
      isDefault?: boolean;
      isActive?: boolean;
      etaBranchCode?: string | null;
      activityCode?: string | null;
      defaultCurrencyCode?: string | null;
      address?: BranchAddressInput;
    },
  ) {
    if (input.defaultCurrencyCode) {
      await this.assertCurrency(input.defaultCurrencyCode);
    }

    const branch = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id: branchId, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Branch not found');
      }

      // Validate the merged result so an address can be completed field by
      // field, but never blanked back out once documents depend on it.
      if (input.address) {
        this.assertCompleteAddress({
          ...branchAddressToIssuerAddress(existing),
          ...input.address,
        });
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

      return tx.branch.update({
        where: { id: branchId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.etaBranchCode !== undefined
            ? { etaBranchCode: input.etaBranchCode }
            : {}),
          ...(input.activityCode !== undefined
            ? { activityCode: input.activityCode }
            : {}),
          ...(input.defaultCurrencyCode !== undefined
            ? { defaultCurrencyCode: input.defaultCurrencyCode }
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
      },
    });
    return this.toDto(branch);
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

  private async assertCurrency(code: string) {
    const found = await this.prisma.currency.findFirst({
      where: { code, isActive: true },
    });
    if (!found) {
      throw new BadRequestException(`Unknown currency: ${code}`);
    }
  }
}
