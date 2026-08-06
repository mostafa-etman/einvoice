import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import type { DocumentStatus } from '@prisma/client';
import { UsageEventService } from './usage-event.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MINIO_CLIENT, MINIO_BUCKET } from '../storage/storage.module';
import type * as Minio from 'minio';

/**
 * Central emit helpers for real product paths (011).
 * Failures are logged and swallowed so metering never blocks core flows.
 */
@Injectable()
export class UsageEmitService {
  private readonly log = new Logger(UsageEmitService.name);

  constructor(
    private readonly events: UsageEventService,
    private readonly tenantPrisma: TenantPrismaService,
    @Optional() @Inject(MINIO_CLIENT) private readonly minio?: Minio.Client,
    @Optional() @Inject(MINIO_BUCKET) private readonly bucket?: string,
  ) {}

  async emitIssued(input: {
    tenantId: string;
    documentId: string;
    branchId?: string | null;
    currencyCode?: string | null;
    occurredAt?: Date;
  }): Promise<void> {
    try {
      await this.events.append({
        tenantId: input.tenantId,
        meter: 'issued',
        quantity: 1,
        occurredAt: input.occurredAt,
        branchId: input.branchId,
        currencyCode: input.currencyCode,
        documentId: input.documentId,
        idempotencyKey: `issued:${input.documentId}`,
      });
    } catch (e) {
      this.log.warn(`emitIssued failed: ${String(e)}`);
    }
  }

  async emitReceived(input: {
    tenantId: string;
    receivedDocumentId: string;
    currencyCode?: string | null;
    branchId?: string | null;
    occurredAt?: Date;
  }): Promise<void> {
    try {
      await this.events.append({
        tenantId: input.tenantId,
        meter: 'received',
        quantity: 1,
        occurredAt: input.occurredAt,
        branchId: input.branchId,
        currencyCode: input.currencyCode,
        receivedDocumentId: input.receivedDocumentId,
        idempotencyKey: `received:${input.receivedDocumentId}`,
      });
    } catch (e) {
      this.log.warn(`emitReceived failed: ${String(e)}`);
    }
  }

  async emitDocumentOutcome(input: {
    tenantId: string;
    documentId: string;
    toStatus: DocumentStatus | string;
    branchId?: string | null;
    currencyCode?: string | null;
    occurredAt?: Date;
  }): Promise<void> {
    const outcome =
      input.toStatus === 'VALID'
        ? 'valid'
        : input.toStatus === 'INVALID'
          ? 'invalid'
          : null;
    if (!outcome) return;
    try {
      let branchId = input.branchId;
      let currencyCode = input.currencyCode;
      if (branchId === undefined || currencyCode === undefined) {
        const doc = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
          tx.document.findUnique({
            where: { id: input.documentId },
            select: { branchId: true, currencyCode: true },
          }),
        );
        branchId = branchId ?? doc?.branchId ?? null;
        currencyCode = currencyCode ?? doc?.currencyCode ?? null;
      }
      await this.events.setDocumentOutcome({
        tenantId: input.tenantId,
        documentId: input.documentId,
        outcome,
        occurredAt: input.occurredAt,
        branchId,
        currencyCode,
      });
    } catch (e) {
      this.log.warn(`emitDocumentOutcome failed: ${String(e)}`);
    }
  }

  async emitApiCall(input: {
    tenantId: string;
    path?: string;
    method?: string;
  }): Promise<void> {
    try {
      const stamp = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);
      await this.events.append({
        tenantId: input.tenantId,
        meter: 'api_calls',
        quantity: 1,
        idempotencyKey: `api:${input.tenantId}:${stamp}:${rand}`,
        metaJson: {
          path: input.path ?? null,
          method: input.method ?? null,
        },
      });
    } catch (e) {
      this.log.warn(`emitApiCall failed: ${String(e)}`);
    }
  }

  /** Absolute gauge of retained bytes under tenants/{tenantId}/ in MinIO. */
  async refreshStorageBytes(tenantId: string): Promise<number> {
    try {
      const bytes = await this.measureTenantStorageBytes(tenantId);
      await this.events.append({
        tenantId,
        meter: 'storage_bytes',
        quantity: bytes,
        idempotencyKey: `storage:${tenantId}:${Date.now()}`,
      });
      return bytes;
    } catch (e) {
      this.log.warn(`refreshStorageBytes failed: ${String(e)}`);
      return 0;
    }
  }

  async measureTenantStorageBytes(tenantId: string): Promise<number> {
    if (!this.minio || !this.bucket) return 0;
    const prefix = `tenants/${tenantId}/`;
    let total = 0;
    return new Promise((resolve, reject) => {
      const stream = this.minio!.listObjectsV2(this.bucket!, prefix, true);
      stream.on('data', (obj) => {
        if (typeof obj.size === 'number') total += obj.size;
      });
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(total));
    });
  }
}
