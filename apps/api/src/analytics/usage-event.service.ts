import { Injectable } from '@nestjs/common';
import { Prisma, UsageMeter } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { UsageMeterCode } from './usage-aggregate';

export type AppendUsageEventInput = {
  tenantId: string;
  meter: UsageMeterCode;
  quantity: number | string;
  occurredAt?: Date;
  branchId?: string | null;
  currencyCode?: string | null;
  documentId?: string | null;
  receivedDocumentId?: string | null;
  idempotencyKey: string;
  metaJson?: Prisma.InputJsonValue;
};

@Injectable()
export class UsageEventService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Idempotent append; duplicate key returns existing row. */
  async append(input: AppendUsageEventInput) {
    const occurredAt = input.occurredAt ?? new Date();
    return this.tenantPrisma.withTenant(input.tenantId, async (tx) => {
      try {
        return await tx.usageEvent.create({
          data: {
            tenantId: input.tenantId,
            meter: input.meter as UsageMeter,
            quantity: new Prisma.Decimal(input.quantity),
            occurredAt,
            branchId: input.branchId ?? null,
            currencyCode: input.currencyCode ?? null,
            documentId: input.documentId ?? null,
            receivedDocumentId: input.receivedDocumentId ?? null,
            idempotencyKey: input.idempotencyKey,
            metaJson: input.metaJson ?? undefined,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return tx.usageEvent.findUniqueOrThrow({
            where: {
              tenantId_meter_idempotencyKey: {
                tenantId: input.tenantId,
                meter: input.meter as UsageMeter,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
        }
        throw err;
      }
    });
  }

  /**
   * Supersede prior valid/invalid for a document, then append the new outcome
   * (analyze I1 — one current outcome; rollup sums remaining events).
   */
  async setDocumentOutcome(input: {
    tenantId: string;
    documentId: string;
    outcome: 'valid' | 'invalid';
    occurredAt?: Date;
    branchId?: string | null;
    currencyCode?: string | null;
  }) {
    const occurredAt = input.occurredAt ?? new Date();
    return this.tenantPrisma.withTenant(input.tenantId, async (tx) => {
      await tx.usageEvent.deleteMany({
        where: {
          tenantId: input.tenantId,
          documentId: input.documentId,
          meter: { in: ['valid', 'invalid'] },
        },
      });
      return tx.usageEvent.create({
        data: {
          tenantId: input.tenantId,
          meter: input.outcome,
          quantity: new Prisma.Decimal(1),
          occurredAt,
          branchId: input.branchId ?? null,
          currencyCode: input.currencyCode ?? null,
          documentId: input.documentId,
          idempotencyKey: `outcome:${input.documentId}`,
        },
      });
    });
  }

  async listInRange(
    tenantId: string,
    fromInclusive: Date,
    toExclusive: Date,
  ) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.usageEvent.findMany({
        where: {
          tenantId,
          occurredAt: { gte: fromInclusive, lt: toExclusive },
        },
        orderBy: { occurredAt: 'asc' },
      }),
    );
  }
}
