import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  listCatalog() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  listTenant(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantCurrency.findMany({
        include: { currency: true },
        orderBy: { currencyCode: 'asc' },
      }),
    );
  }

  async enable(
    tenantId: string,
    actorUserId: string,
    currencyCode: string,
    isDefault?: boolean,
  ) {
    const catalog = await this.prisma.currency.findFirst({
      where: { code: currencyCode, isActive: true },
    });
    if (!catalog) {
      throw new BadRequestException(`Unknown currency: ${currencyCode}`);
    }

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantCurrency.findUnique({
        where: {
          tenantId_currencyCode: { tenantId, currencyCode },
        },
        include: { currency: true },
      });
      if (existing) {
        return existing;
      }

      const count = await tx.tenantCurrency.count({ where: { tenantId } });
      const makeDefault = isDefault === true || count === 0;
      if (makeDefault) {
        await tx.tenantCurrency.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.tenantCurrency.create({
        data: {
          tenantId,
          currencyCode,
          isDefault: makeDefault,
        },
        include: { currency: true },
      });
    });

    await this.audit.write({
      action: 'settings.currency.enable',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant_currency',
      resourceId: row.id,
      metadata: { currencyCode, isDefault: row.isDefault },
    });
    return row;
  }

  async setDefault(tenantId: string, actorUserId: string, currencyCode: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantCurrency.findUnique({
        where: { tenantId_currencyCode: { tenantId, currencyCode } },
        include: { currency: true },
      });
      if (!existing) {
        throw new NotFoundException('Currency not enabled for tenant');
      }
      await tx.tenantCurrency.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.tenantCurrency.update({
        where: { id: existing.id },
        data: { isDefault: true },
        include: { currency: true },
      });
    });

    await this.audit.write({
      action: 'settings.currency.set_default',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant_currency',
      resourceId: row.id,
      metadata: { currencyCode },
    });
    return row;
  }
}
