import {
  BadRequestException,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { EtaEnvironment, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  isProductionProtectedDocument,
  resolveEtaHostUrls,
} from '../../eta/eta-environment';
import { loadEnv } from '../../config/env';

export const CLEAR_SANDBOX_PHRASE = 'CLEAR SANDBOX DATA';

export type EtaEnvironmentStatus = {
  activeEnvironment: EtaEnvironment;
  label: 'sandbox' | 'production';
  identityBaseUrl: string;
  apiBaseUrl: string;
  sandboxCredentialsConfigured: boolean;
  productionCredentialsConfigured: boolean;
  productionValidatedAt: string | null;
  canSwitchToProduction: boolean;
  sandboxDocumentCount: number;
  productionDocumentCount: number;
  productionProtectedCount: number;
};

export type ClearSandboxResult = {
  deletedDocuments: number;
  deletedReceivedDocuments: number;
  deletedSubmissions: number;
  deletedArtifacts: number;
  skippedProductionProtected: number;
};

@Injectable()
export class EtaEnvironmentService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getStatus(tenantId: string): Promise<EtaEnvironmentStatus> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { activeEtaEnvironment: true },
    });
    const hosts = resolveEtaHostUrls(
      tenant.activeEtaEnvironment,
      loadEnv(),
    );

    const counts = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [
        sandboxCreds,
        productionCreds,
        sandboxDocumentCount,
        productionDocumentCount,
        productionProtectedRows,
      ] = await Promise.all([
        tx.tenantEtaCredential.findFirst({
          where: { tenantId, environment: 'SANDBOX', branchId: null },
          select: { id: true },
        }),
        tx.tenantEtaCredential.findFirst({
          where: { tenantId, environment: 'PRODUCTION', branchId: null },
          select: { id: true, lastValidatedAt: true, clientId: true },
        }),
        tx.document.count({
          where: { tenantId, etaEnvironment: 'SANDBOX' },
        }),
        tx.document.count({
          where: { tenantId, etaEnvironment: 'PRODUCTION' },
        }),
        tx.document.findMany({
          where: { tenantId, etaEnvironment: 'PRODUCTION' },
          select: {
            etaEnvironment: true,
            etaUuid: true,
            etaStatus: true,
            status: true,
          },
        }),
      ]);

      const productionProtectedCount = productionProtectedRows.filter((d) =>
        isProductionProtectedDocument(d),
      ).length;

      return {
        sandboxCredentialsConfigured: Boolean(sandboxCreds),
        productionCredentialsConfigured: Boolean(productionCreds?.clientId),
        productionValidatedAt:
          productionCreds?.lastValidatedAt?.toISOString() ?? null,
        sandboxDocumentCount,
        productionDocumentCount,
        productionProtectedCount,
      };
    });

    return {
      activeEnvironment: tenant.activeEtaEnvironment,
      label: hosts.label,
      identityBaseUrl: hosts.identityBaseUrl,
      apiBaseUrl: hosts.apiBaseUrl,
      ...counts,
      canSwitchToProduction:
        counts.productionCredentialsConfigured &&
        Boolean(counts.productionValidatedAt),
    };
  }

  async switchEnvironment(
    tenantId: string,
    actorUserId: string,
    target: EtaEnvironment,
  ): Promise<EtaEnvironmentStatus> {
    if (target !== 'SANDBOX' && target !== 'PRODUCTION') {
      throw new BadRequestException({
        code: 'INVALID_ETA_ENVIRONMENT',
        message: 'environment must be SANDBOX or PRODUCTION',
      });
    }

    const current = await this.getStatus(tenantId);
    if (current.activeEnvironment === target) {
      return current;
    }

    if (target === 'PRODUCTION') {
      await this.assertProductionReady(tenantId);
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { activeEtaEnvironment: target },
    });

    await this.audit.write({
      action: 'settings.eta_environment.switch',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {
        from: current.activeEnvironment,
        to: target,
      },
    });

    return this.getStatus(tenantId);
  }

  /**
   * Go live: switch to production and optionally clear sandbox test invoices.
   */
  async goLive(
    tenantId: string,
    actorUserId: string,
    opts: {
      clearSandboxData?: boolean;
      confirmation?: string;
    },
  ): Promise<{
    environment: EtaEnvironmentStatus;
    clear?: ClearSandboxResult;
  }> {
    const environment = await this.switchEnvironment(
      tenantId,
      actorUserId,
      'PRODUCTION',
    );

    let clear: ClearSandboxResult | undefined;
    if (opts.clearSandboxData) {
      clear = await this.clearSandboxData(
        tenantId,
        actorUserId,
        opts.confirmation ?? '',
      );
    }

    await this.audit.write({
      action: 'settings.eta_environment.go_live',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {
        clearSandboxData: Boolean(opts.clearSandboxData),
        clear,
      },
    });

    return { environment, clear };
  }

  /**
   * Delete sandbox/test documents and related records only.
   * Never deletes production-submitted/accepted ETA records or tenant settings.
   */
  async clearSandboxData(
    tenantId: string,
    actorUserId: string,
    confirmation: string,
  ): Promise<ClearSandboxResult> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, legalName: true },
    });
    this.assertClearConfirmation(confirmation, tenant);

    const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const productionDocs = await tx.document.findMany({
        where: { tenantId, etaEnvironment: 'PRODUCTION' },
        select: {
          id: true,
          etaEnvironment: true,
          etaUuid: true,
          etaStatus: true,
          status: true,
        },
      });
      const protectedDocs = productionDocs.filter((d) =>
        isProductionProtectedDocument(d),
      );

      // Strict: only rows explicitly stamped SANDBOX (migration backfilled legacy).
      const sandboxDocWhere: Prisma.DocumentWhereInput = {
        tenantId,
        etaEnvironment: 'SANDBOX',
      };

      const sandboxDocs = await tx.document.findMany({
        where: sandboxDocWhere,
        select: {
          id: true,
          etaEnvironment: true,
          etaUuid: true,
          etaStatus: true,
          status: true,
        },
      });
      const clearable = sandboxDocs.filter(
        (d) => !isProductionProtectedDocument(d),
      );
      const skipped = sandboxDocs.length - clearable.length;
      if (skipped > 0) {
        throw new ForbiddenException({
          code: 'PRODUCTION_RECORDS_PROTECTED',
          message:
            'Refusing to clear: one or more documents look like production tax records. Only sandbox/test documents can be deleted.',
          skippedProductionProtected: skipped,
        });
      }

      const documentIds = clearable.map((d) => d.id);

      const sandboxRecvWhere: Prisma.ReceivedDocumentWhereInput = {
        tenantId,
        etaEnvironment: 'SANDBOX',
      };
      const received = await tx.receivedDocument.findMany({
        where: sandboxRecvWhere,
        select: { id: true },
      });
      const receivedIds = received.map((r) => r.id);

      const sandboxSubWhere: Prisma.SubmissionWhereInput = {
        tenantId,
        etaEnvironment: 'SANDBOX',
      };
      const submissions = await tx.submission.findMany({
        where: sandboxSubWhere,
        select: { id: true },
      });
      const submissionIds = submissions.map((s) => s.id);

      // Related rows first (filing locks cascade via submission documents).
      if (documentIds.length) {
        await tx.documentFilingLock.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.documentStatusEvent.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.signatureJob.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.syncConflict.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.submissionDocument.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.documentArtifact.deleteMany({
          where: { tenantId, documentId: { in: documentIds } },
        });
        await tx.documentLine.deleteMany({
          where: { documentId: { in: documentIds } },
        });
        await tx.document.deleteMany({
          where: { tenantId, id: { in: documentIds } },
        });
      }

      if (receivedIds.length) {
        await tx.documentArtifact.deleteMany({
          where: { tenantId, receivedDocumentId: { in: receivedIds } },
        });
        await tx.receivedDocumentLine.deleteMany({
          where: { receivedDocumentId: { in: receivedIds } },
        });
        await tx.receivedDocument.deleteMany({
          where: { tenantId, id: { in: receivedIds } },
        });
      }

      if (submissionIds.length) {
        await tx.submissionDocument.deleteMany({
          where: { tenantId, submissionId: { in: submissionIds } },
        });
        await tx.submission.deleteMany({
          where: { tenantId, id: { in: submissionIds } },
        });
      }

      // Orphan sandbox artifacts with no document link (export leftovers).
      const orphanArtifacts = await tx.documentArtifact.deleteMany({
        where: {
          tenantId,
          documentId: null,
          receivedDocumentId: null,
        },
      });

      return {
        deletedDocuments: documentIds.length,
        deletedReceivedDocuments: receivedIds.length,
        deletedSubmissions: submissionIds.length,
        deletedArtifacts: orphanArtifacts.count,
        skippedProductionProtected: protectedDocs.length,
      } satisfies ClearSandboxResult;
    });

    await this.audit.write({
      action: 'settings.sandbox_data.clear',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {
        ...result,
        confirmationMatched: true,
        irreversible: true,
      },
    });

    return result;
  }

  private async assertProductionReady(tenantId: string): Promise<void> {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantEtaCredential.findFirst({
        where: { tenantId, environment: 'PRODUCTION', branchId: null },
      }),
    );
    if (!row?.clientId || !row.clientSecretCiphertext?.length) {
      throw new BadRequestException({
        code: 'PRODUCTION_CREDENTIALS_REQUIRED',
        message:
          'Enter and save production ETA Client ID / Secret before switching to Production.',
      });
    }
    if (!row.lastValidatedAt) {
      throw new BadRequestException({
        code: 'PRODUCTION_CONNECTION_UNTESTED',
        message:
          'Run Test Connection against production credentials successfully before switching to Production.',
      });
    }
  }

  private assertClearConfirmation(
    confirmation: string,
    tenant: { name: string; legalName: string | null },
  ): void {
    const trimmed = confirmation.trim();
    if (!trimmed) {
      throw new BadRequestException({
        code: 'CONFIRMATION_REQUIRED',
        message: `Type the company name or "${CLEAR_SANDBOX_PHRASE}" to confirm irreversible deletion.`,
      });
    }
    const candidates = [
      CLEAR_SANDBOX_PHRASE,
      tenant.legalName?.trim(),
      tenant.name?.trim(),
    ]
      .filter((v): v is string => Boolean(v))
      .map((v) => v.toLowerCase());

    if (!candidates.includes(trimmed.toLowerCase())) {
      throw new BadRequestException({
        code: 'CONFIRMATION_MISMATCH',
        message: `Confirmation must exactly match the company legal name, workspace name, or "${CLEAR_SANDBOX_PHRASE}".`,
      });
    }
  }
}
