import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BranchesSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.branch.findMany({ orderBy: { createdAt: 'asc' } }),
    );
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
    },
  ) {
    if (input.defaultCurrencyCode) {
      await this.assertCurrency(input.defaultCurrencyCode);
    }

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
    return branch;
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
    return branch;
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
