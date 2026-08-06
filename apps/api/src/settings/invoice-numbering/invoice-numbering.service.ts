import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  DocumentKind,
  InvoiceNumberCharset,
  InvoiceNumberScope,
  Prisma,
} from '@prisma/client';
import {
  formatInternalId,
  isValidEtaInternalId,
  validateInternalIdScheme,
} from '@einvoice/eta-core';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';

export type NumberingView = {
  prefix: string;
  padWidth: number;
  startingNumber: number;
  charset: InvoiceNumberCharset;
  scope: InvoiceNumberScope;
  previewNext: string;
};

function scopeKey(
  scope: InvoiceNumberScope,
  branchId?: string | null,
  kind?: DocumentKind | string | null,
): { key: string; branchId: string | null; documentKind: string | null } {
  switch (scope) {
    case 'BRANCH':
      return {
        key: branchId?.trim() || '_',
        branchId: branchId?.trim() || null,
        documentKind: null,
      };
    case 'DOCUMENT_KIND':
      return {
        key: kind?.trim() || '_',
        branchId: null,
        documentKind: kind?.trim() || null,
      };
    case 'BRANCH_AND_KIND':
      return {
        key: `${branchId?.trim() || '_'}::${kind?.trim() || '_'}`,
        branchId: branchId?.trim() || null,
        documentKind: kind?.trim() || null,
      };
    case 'TENANT':
    default:
      return { key: '', branchId: null, documentKind: null };
  }
}

@Injectable()
export class InvoiceNumberingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private async ensureScheme(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ) {
    const existing = await tx.tenantInvoiceNumbering.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;
    return tx.tenantInvoiceNumbering.create({
      data: {
        tenantId,
        prefix: 'INV-',
        padWidth: 6,
        startingNumber: 1,
        charset: 'NUMERIC',
        scope: 'TENANT',
      },
    });
  }

  async get(tenantId: string): Promise<NumberingView> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const scheme = await this.ensureScheme(tx, tenantId);
      const seq = await tx.documentNumberSequence.findUnique({
        where: {
          tenantId_scopeKey: { tenantId, scopeKey: '' },
        },
      });
      const nextNum = Math.max(
        scheme.startingNumber,
        Number(seq?.lastValue ?? 0n) + 1,
      );
      return {
        prefix: scheme.prefix,
        padWidth: scheme.padWidth,
        startingNumber: scheme.startingNumber,
        charset: scheme.charset,
        scope: scheme.scope,
        previewNext: formatInternalId(
          scheme.prefix,
          nextNum,
          scheme.padWidth,
        ),
      };
    });
  }

  async upsert(
    tenantId: string,
    actorUserId: string,
    input: {
      prefix: string;
      padWidth: number;
      startingNumber: number;
      charset: InvoiceNumberCharset;
      scope: InvoiceNumberScope;
    },
  ): Promise<NumberingView> {
    const issues = validateInternalIdScheme({
      prefix: input.prefix,
      padWidth: input.padWidth,
      startingNumber: input.startingNumber,
      charset: input.charset,
    });
    if (issues.length) {
      throw new BadRequestException({
        code: 'INVALID_NUMBERING_SCHEME',
        message: issues[0]!.message,
        issues,
      });
    }

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await this.ensureScheme(tx, tenantId);
      await tx.tenantInvoiceNumbering.update({
        where: { tenantId },
        data: {
          prefix: input.prefix,
          padWidth: input.padWidth,
          startingNumber: input.startingNumber,
          charset: input.charset,
          scope: input.scope,
        },
      });
    });

    await this.audit.write({
      action: 'settings.numbering.upsert',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant_invoice_numbering',
      resourceId: tenantId,
      metadata: { prefix: input.prefix, scope: input.scope },
    });

    return this.get(tenantId);
  }

  /**
   * Atomically allocate the next internalId for the tenant scheme.
   * Guarantees uniqueness via sequence + optional collision retry against documents.
   */
  async allocateNext(
    tenantId: string,
    opts?: { branchId?: string; kind?: DocumentKind | string },
  ): Promise<{ internalId: string; sequenceNumber: number }> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const scheme = await this.ensureScheme(tx, tenantId);
      const scoped = scopeKey(scheme.scope, opts?.branchId, opts?.kind);

      for (let attempt = 0; attempt < 25; attempt++) {
        const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
          INSERT INTO document_number_sequences (
            id, tenant_id, scope_key, branch_id, document_kind, last_value, updated_at
          ) VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${scoped.key},
            ${scoped.branchId},
            ${scoped.documentKind},
            ${scheme.startingNumber},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (tenant_id, scope_key) DO UPDATE
          SET
            last_value = GREATEST(
              document_number_sequences.last_value + 1,
              ${scheme.startingNumber}
            ),
            updated_at = CURRENT_TIMESTAMP
          RETURNING last_value
        `;
        const bumped = Number(rows[0]!.last_value);
        const internalId = formatInternalId(
          scheme.prefix,
          bumped,
          scheme.padWidth,
        );
        if (!isValidEtaInternalId(internalId)) {
          throw new BadRequestException({
            code: 'INVALID_INTERNAL_ID',
            message: `Generated internalId "${internalId}" is not ETA-safe; fix the numbering scheme in Settings`,
          });
        }

        const clash = await tx.document.findFirst({
          where: { tenantId, internalId },
          select: { id: true },
        });
        if (!clash) {
          return { internalId, sequenceNumber: bumped };
        }
        // Collision (manual override or legacy id) — loop allocates again.
      }

      throw new ConflictException(
        'Could not allocate a unique internalId; check Settings → Invoice numbering',
      );
    });
  }

  /** Peek without consuming (for settings preview). */
  async peekNext(
    tenantId: string,
    opts?: { branchId?: string; kind?: DocumentKind | string },
  ): Promise<string> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const scheme = await this.ensureScheme(tx, tenantId);
      const scoped = scopeKey(scheme.scope, opts?.branchId, opts?.kind);
      const seq = await tx.documentNumberSequence.findUnique({
        where: {
          tenantId_scopeKey: { tenantId, scopeKey: scoped.key },
        },
      });
      const next = Math.max(
        scheme.startingNumber,
        Number(seq?.lastValue ?? 0n) + 1,
      );
      return formatInternalId(scheme.prefix, next, scheme.padWidth);
    });
  }
}
