import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ItemCodeType, Prisma } from '@prisma/client';
import { loadEnv } from '../../config/env';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EtaService } from '../../eta/eta.service';
import {
  EtaItemCodesClient,
  type EtaItemCodeType,
  type EtaPublishedCode,
} from '../../eta/eta-item-codes.client';

export type UpsertCounters = {
  added: number;
  updated: number;
  unchanged: number;
};

export function applyUpsertCounters(
  existing: {
    description: string;
    isActive: boolean;
    source: 'LOCAL' | 'ETA';
  } | null,
  incoming: EtaPublishedCode,
): { action: 'added' | 'updated' | 'unchanged'; nextSource: 'ETA' } {
  if (!existing) {
    return { action: 'added', nextSource: 'ETA' };
  }
  const same =
    existing.description === incoming.description &&
    existing.isActive === incoming.isActive &&
    existing.source === 'ETA';
  return {
    action: same ? 'unchanged' : 'updated',
    nextSource: 'ETA',
  };
}

@Injectable()
export class ItemCodesSyncService {
  private readonly logger = new Logger(ItemCodesSyncService.name);
  private client: EtaItemCodesClient;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly eta: EtaService,
    private readonly audit: AuditService,
  ) {
    const env = loadEnv();
    this.client = new EtaItemCodesClient(env.ETA_API_BASE_URL);
  }

  /** Test seam */
  setClientForTests(client: EtaItemCodesClient) {
    this.client = client;
  }

  async startSync(tenantId: string, triggeredByUserId: string) {
    const busy = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCodeSyncRun.findFirst({
        where: {
          tenantId,
          status: { in: ['PENDING', 'RUNNING'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (busy || this.inFlight.has(tenantId)) {
      throw new ConflictException({
        code: 'ITEM_CODE_SYNC_IN_PROGRESS',
        message: 'An item-code sync is already running for this tenant',
        syncRunId: busy?.id,
      });
    }

    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCodeSyncRun.create({
        data: {
          tenantId,
          status: 'PENDING',
          triggeredByUserId,
        },
      }),
    );

    this.inFlight.add(tenantId);
    void this.executeRun(tenantId, run.id, triggeredByUserId).finally(() => {
      this.inFlight.delete(tenantId);
    });

    await this.audit.write({
      action: 'settings.item_code.sync.start',
      outcome: 'success',
      actorUserId: triggeredByUserId,
      tenantId,
      resourceType: 'item_code_sync_run',
      resourceId: run.id,
      metadata: {},
    });

    return {
      syncRunId: run.id,
      status: run.status,
    };
  }

  async latestSync(tenantId: string) {
    const run = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCodeSyncRun.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!run) {
      return {
        syncRunId: null,
        status: null,
        startedAt: null,
        finishedAt: null,
        added: 0,
        updated: 0,
        unchanged: 0,
        errors: null,
        lastSyncAt: null,
      };
    }
    return {
      syncRunId: run.id,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      added: run.addedCount,
      updated: run.updatedCount,
      unchanged: run.unchangedCount,
      errors: run.errorsJson,
      lastSyncAt: (run.finishedAt ?? run.startedAt ?? run.createdAt).toISOString(),
    };
  }

  async executeRun(
    tenantId: string,
    runId: string,
    triggeredByUserId: string,
  ): Promise<UpsertCounters> {
    const counters: UpsertCounters = { added: 0, updated: 0, unchanged: 0 };
    const errors: Array<{ type: string; message: string }> = [];

    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.itemCodeSyncRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      const accessToken = await this.eta.getAccessToken(tenantId);
      const taxpayerRin = await this.resolveTaxpayerRin(tenantId);

      for (const codeType of ['EGS', 'GS1'] as EtaItemCodeType[]) {
        try {
          for await (const page of this.client.paginateAll(accessToken, codeType, {
            pageSize: 100,
            taxpayerRin: taxpayerRin ?? undefined,
            onlyActive: false,
          })) {
            const pageCounters = await this.upsertPage(
              tenantId,
              codeType,
              page.items,
            );
            counters.added += pageCounters.added;
            counters.updated += pageCounters.updated;
            counters.unchanged += pageCounters.unchanged;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Item-code sync ${codeType} failed: ${message}`);
          errors.push({ type: codeType, message });
        }
      }

      const failed = errors.length === 2;
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.itemCodeSyncRun.update({
          where: { id: runId },
          data: {
            status: failed ? 'FAILED' : 'SUCCEEDED',
            finishedAt: new Date(),
            addedCount: counters.added,
            updatedCount: counters.updated,
            unchangedCount: counters.unchanged,
            errorsJson:
              errors.length > 0
                ? (errors as unknown as Prisma.InputJsonValue)
                : undefined,
          },
        }),
      );

      await this.audit.write({
        action: failed
          ? 'settings.item_code.sync.failure'
          : 'settings.item_code.sync.success',
        outcome: failed ? 'failure' : 'success',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'item_code_sync_run',
        resourceId: runId,
        metadata: { ...counters, errorCount: errors.length },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.itemCodeSyncRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            addedCount: counters.added,
            updatedCount: counters.updated,
            unchangedCount: counters.unchanged,
            errorsJson: [{ type: 'ALL', message }] as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      await this.audit.write({
        action: 'settings.item_code.sync.failure',
        outcome: 'failure',
        actorUserId: triggeredByUserId,
        tenantId,
        resourceType: 'item_code_sync_run',
        resourceId: runId,
        metadata: { message },
      });
    }

    return counters;
  }

  async upsertPage(
    tenantId: string,
    codeType: EtaItemCodeType,
    items: EtaPublishedCode[],
  ): Promise<UpsertCounters> {
    const counters: UpsertCounters = { added: 0, updated: 0, unchanged: 0 };
    const now = new Date();

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      for (const item of items) {
        const existing = await tx.itemCode.findUnique({
          where: {
            tenantId_type_code: {
              tenantId,
              type: codeType as ItemCodeType,
              code: item.code,
            },
          },
        });
        const decision = applyUpsertCounters(
          existing
            ? {
                description: existing.description,
                isActive: existing.isActive,
                source: existing.source,
              }
            : null,
          item,
        );

        if (decision.action === 'added') {
          await tx.itemCode.create({
            data: {
              tenantId,
              type: codeType as ItemCodeType,
              code: item.code,
              description: item.description,
              isActive: item.isActive,
              source: 'ETA',
              lastSyncStatus: 'synced',
              lastSyncAt: now,
            },
          });
          counters.added += 1;
        } else if (decision.action === 'updated') {
          await tx.itemCode.update({
            where: { id: existing!.id },
            data: {
              description: item.description,
              isActive: item.isActive,
              source: 'ETA',
              lastSyncStatus: 'synced',
              lastSyncAt: now,
            },
          });
          counters.updated += 1;
        } else {
          await tx.itemCode.update({
            where: { id: existing!.id },
            data: {
              lastSyncStatus: 'synced',
              lastSyncAt: now,
            },
          });
          counters.unchanged += 1;
        }
      }
    });

    return counters;
  }

  private async resolveTaxpayerRin(tenantId: string): Promise<string | null> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantEtaCredential.findFirst({
        where: { tenantId, branchId: null },
        select: { registrationNumber: true },
      }),
    );
    return row?.registrationNumber?.trim() || null;
  }
}
