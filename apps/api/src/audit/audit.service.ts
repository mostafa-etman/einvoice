import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async write(input: {
    action: string;
    outcome: string;
    actorUserId?: string | null;
    tenantId?: string | null;
    resourceType?: string;
    resourceId?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const data = {
      action: input.action,
      outcome: input.outcome,
      actorUserId: input.actorUserId ?? null,
      tenantId: input.tenantId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
    };

    if (input.tenantId) {
      return this.tenantPrisma.withTenant(input.tenantId, (tx) =>
        tx.auditLog.create({ data }),
      );
    }
    return this.prisma.auditLog.create({ data });
  }
}
