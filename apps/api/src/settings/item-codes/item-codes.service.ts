import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ItemCodeType } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';

const ALLOWED_TYPES = new Set(['EGS', 'GS1']);

@Injectable()
export class ItemCodesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    tenantId: string,
    filters?: { q?: string; type?: string; active?: boolean },
  ) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCode.findMany({
        where: {
          ...(filters?.type ? { type: filters.type as ItemCodeType } : {}),
          ...(filters?.active !== undefined
            ? { isActive: filters.active }
            : {}),
          ...(filters?.q
            ? {
                OR: [
                  { code: { contains: filters.q, mode: 'insensitive' } },
                  {
                    description: {
                      contains: filters.q,
                      mode: 'insensitive',
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      }),
    );
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: { type: string; code: string; description: string },
  ) {
    if (!ALLOWED_TYPES.has(input.type)) {
      throw new BadRequestException('type must be EGS or GS1');
    }
    const code = input.code.trim();
    if (!code) {
      throw new BadRequestException('code is required');
    }

    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCode.create({
        data: {
          tenantId,
          type: input.type as ItemCodeType,
          code,
          description: input.description,
          source: 'LOCAL',
        },
      }),
    );

    await this.audit.write({
      action: 'settings.item_code.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'item_code',
      resourceId: row.id,
      metadata: { type: row.type, code: row.code },
    });
    return row;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: { description?: string; isActive?: boolean },
  ) {
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.itemCode.findFirst({ where: { id, tenantId } });
      if (!existing) {
        throw new NotFoundException('Item code not found');
      }
      return tx.itemCode.update({
        where: { id },
        data: {
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    });

    await this.audit.write({
      action:
        input.isActive === false
          ? 'settings.item_code.deactivate'
          : 'settings.item_code.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'item_code',
      resourceId: row.id,
      metadata: { isActive: row.isActive },
    });
    return row;
  }
}
