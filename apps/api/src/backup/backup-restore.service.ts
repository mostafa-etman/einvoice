import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DocumentKind, DocumentStatus, ItemCodeSource, ItemCodeType } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsEncryptionService } from '../crypto/secrets-encryption.service';
import { AuditService } from '../audit/audit.service';
import {
  BackupArchiveService,
  type BackupArchivePayload,
} from './backup-archive.service';
import { EmptyOrgGuard } from './empty-org.guard';

type ArtifactStorage = {
  putByKey: (
    key: string,
    body: Buffer,
    contentType: string,
  ) => Promise<{ key: string; byteSize: number }>;
};

@Injectable()
export class BackupRestoreService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly archive: BackupArchiveService,
    private readonly emptyOrg: EmptyOrgGuard,
    private readonly secrets: SecretsEncryptionService,
    private readonly audit: AuditService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async restoreTenantPath(input: {
    tenantId: string;
    backupJobId: string;
    confirmation: string;
    actorUserId: string;
  }) {
    if (input.confirmation !== 'RESTORE') {
      throw new BadRequestException('confirmation_required');
    }

    const job = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantBackupJob.findFirst({
        where: { id: input.backupJobId, tenantId: input.tenantId },
      }),
    );
    if (!job || job.status !== 'COMPLETED' || !job.objectKey || !job.checksumSha256) {
      throw new BadRequestException('backup_not_restorable');
    }

    // TENANT path: sourceTenantId === targetTenantId only
    if (job.tenantId !== input.tenantId) {
      throw new ForbiddenException('ownership_mismatch');
    }

    return this.runRestore({
      targetTenantId: input.tenantId,
      sourceTenantId: job.tenantId,
      sourceBackupJobId: job.id,
      sourceObjectKey: job.objectKey,
      sourceChecksumSha256: job.checksumSha256,
      actorUserId: input.actorUserId,
      actorIsPlatformOperator: false,
      confirmation: input.confirmation,
    });
  }

  async restoreOperatorPath(input: {
    targetTenantId: string;
    sourceObjectKey: string;
    expectedChecksumSha256: string;
    sourceTenantId: string;
    confirmation: string;
    actorUserId: string;
    backupJobId?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.actorUserId },
    });
    if (!user?.isPlatformOperator) {
      throw new ForbiddenException('operator_required');
    }
    if (input.confirmation !== 'RESTORE') {
      throw new BadRequestException('confirmation_required');
    }

    return this.runRestore({
      targetTenantId: input.targetTenantId,
      sourceTenantId: input.sourceTenantId,
      sourceBackupJobId: input.backupJobId ?? null,
      sourceObjectKey: input.sourceObjectKey,
      sourceChecksumSha256: input.expectedChecksumSha256,
      actorUserId: input.actorUserId,
      actorIsPlatformOperator: true,
      confirmation: input.confirmation,
    });
  }

  private async runRestore(input: {
    targetTenantId: string;
    sourceTenantId: string;
    sourceBackupJobId: string | null;
    sourceObjectKey: string;
    sourceChecksumSha256: string;
    actorUserId: string;
    actorIsPlatformOperator: boolean;
    confirmation: string;
  }) {
    if (
      !input.actorIsPlatformOperator &&
      input.sourceTenantId !== input.targetTenantId
    ) {
      throw new ForbiddenException('ownership_mismatch');
    }

    const empty = await this.emptyOrg.assertEmpty(input.targetTenantId);
    if (!empty.empty) {
      throw new BadRequestException(`target_not_empty:${empty.reason}`);
    }

    const restoreJob = await this.tenantPrisma.withTenant(
      input.targetTenantId,
      (tx) =>
        tx.tenantRestoreJob.create({
          data: {
            tenantId: input.targetTenantId,
            sourceBackupJobId: input.sourceBackupJobId,
            sourceTenantId: input.sourceTenantId,
            sourceChecksumSha256: input.sourceChecksumSha256,
            sourceObjectKey: input.sourceObjectKey,
            status: 'RUNNING',
            confirmationToken: input.confirmation,
            actorUserId: input.actorUserId,
            actorIsPlatformOperator: input.actorIsPlatformOperator,
            ownershipCheckPassed: true,
            emptyOrgCheckPassed: true,
            startedAt: new Date(),
          },
        }),
    );

    try {
      const payload = await this.archive.loadAndDecrypt(
        input.sourceObjectKey,
        input.sourceChecksumSha256,
      );
      if (payload.sourceTenantId !== input.sourceTenantId) {
        throw new BadRequestException('ownership_mismatch');
      }

      await this.applyPayload(input.targetTenantId, payload);

      const updated = await this.tenantPrisma.withTenant(
        input.targetTenantId,
        (tx) =>
          tx.tenantRestoreJob.update({
            where: { id: restoreJob.id },
            data: {
              status: 'COMPLETED',
              checksumCheckPassed: true,
              completedAt: new Date(),
            },
          }),
      );

      await this.audit.write({
        action: 'backup.restore',
        outcome: 'success',
        actorUserId: input.actorUserId,
        tenantId: input.targetTenantId,
        resourceType: 'TenantRestoreJob',
        resourceId: restoreJob.id,
        metadata: {
          sourceTenantId: input.sourceTenantId,
          operator: input.actorIsPlatformOperator,
        },
      });

      return updated;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'restore_failed';
      const safe =
        message === 'CHECKSUM_MISMATCH' ? 'checksum_mismatch' : 'restore_failed';
      await this.tenantPrisma.withTenant(input.targetTenantId, (tx) =>
        tx.tenantRestoreJob.update({
          where: { id: restoreJob.id },
          data: {
            status: 'FAILED',
            checksumCheckPassed: message !== 'CHECKSUM_MISMATCH' ? true : false,
            errorCode: safe,
            errorMessage: safe,
            completedAt: new Date(),
          },
        }),
      );
      await this.audit.write({
        action: 'backup.restore',
        outcome: 'failure',
        actorUserId: input.actorUserId,
        tenantId: input.targetTenantId,
        resourceType: 'TenantRestoreJob',
        resourceId: restoreJob.id,
        metadata: { error: safe },
      });
      if (message === 'CHECKSUM_MISMATCH') {
        throw new BadRequestException('checksum_mismatch');
      }
      throw err;
    }
  }

  private async applyPayload(
    targetTenantId: string,
    payload: BackupArchivePayload,
  ): Promise<void> {
    await this.secrets.ensureReady();

    await this.tenantPrisma.withTenant(targetTenantId, async (tx) => {
      for (const doc of payload.documents) {
        const id = String(doc.id);
        await tx.document.create({
          data: {
            id,
            tenantId: targetTenantId,
            kind: doc.kind as DocumentKind,
            status: doc.status as DocumentStatus,
            branchId: String(doc.branchId),
            currencyCode: String(doc.currencyCode),
            exchangeRate: (doc.exchangeRate as string | null) ?? null,
            issueDateTime: new Date(String(doc.issueDateTime)),
            internalId: String(doc.internalId),
            etaDocumentType: String(doc.etaDocumentType),
            etaDocumentTypeVersion: String(doc.etaDocumentTypeVersion),
            typeVersionFetchedAt: new Date(String(doc.typeVersionFetchedAt)),
            receiverType: (doc.receiverType as string | null) ?? null,
            receiverId: (doc.receiverId as string | null) ?? null,
            receiverName: (doc.receiverName as string | null) ?? null,
            receiverAddressJson: (doc.receiverAddressJson as object) ?? undefined,
            issuerSnapshotJson: (doc.issuerSnapshotJson as object) ?? {},
            referencesJson: (doc.referencesJson as object) ?? undefined,
            extraDiscountAmount: String(doc.extraDiscountAmount ?? '0.00'),
            totalSalesAmount: String(doc.totalSalesAmount ?? '0.00'),
            totalDiscountAmount: String(doc.totalDiscountAmount ?? '0.00'),
            netAmount: String(doc.netAmount ?? '0.00'),
            totalAmount: String(doc.totalAmount ?? '0.00'),
            totalItemsDiscountAmount: String(
              doc.totalItemsDiscountAmount ?? '0.00',
            ),
            taxTotalsJson: (doc.taxTotalsJson as object) ?? [],
            etaPayloadJson: (doc.etaPayloadJson as object) ?? {},
            etaPayloadText: (doc.etaPayloadText as string | null) ?? null,
            version: Number(doc.version ?? 0),
            syncRevision: Number(doc.syncRevision ?? 0),
            createdByUserId: (doc.createdByUserId as string | null) ?? null,
            updatedByUserId: (doc.updatedByUserId as string | null) ?? null,
          },
        });
      }

      for (const line of payload.documentLines) {
        await tx.documentLine.create({
          data: {
            id: String(line.id),
            tenantId: targetTenantId,
            documentId: String(line.documentId),
            lineNumber: Number(line.lineNumber),
            description: String(line.description ?? ''),
            itemType: String(line.itemType ?? 'EGS'),
            itemCode: String(line.itemCode ?? ''),
            unitType: String(line.unitType ?? 'EA'),
            quantity: String(line.quantity ?? '1'),
            unitPrice: String(line.unitPrice ?? '0'),
            discountAmount: String(line.discountAmount ?? '0.00'),
            salesTotal: String(line.salesTotal ?? '0.00'),
            netTotal: String(line.netTotal ?? '0.00'),
            total: String(line.total ?? '0.00'),
            valueDifference: String(line.valueDifference ?? '0.00'),
            totalTaxableFees: String(line.totalTaxableFees ?? '0.00'),
            itemsDiscount: String(line.itemsDiscount ?? '0.00'),
            internalCode: (line.internalCode as string | null) ?? null,
          },
        });
      }

      for (const art of payload.artifacts) {
        const body = Buffer.from(art.bodyBase64, 'base64');
        const key = art.minioKey.includes(targetTenantId)
          ? art.minioKey
          : art.minioKey.replace(payload.sourceTenantId, targetTenantId);
        await this.artifacts.putByKey(key, body, art.contentType);
        await tx.documentArtifact.create({
          data: {
            id: art.id,
            tenantId: targetTenantId,
            documentId: art.documentId,
            kind: art.kind,
            minioBucket: art.minioBucket,
            minioKey: key,
            contentType: art.contentType,
            byteSize: body.byteLength,
          },
        });
      }

      for (const cred of payload.etaCredentials) {
        const oldCipher = Buffer.from(cred.clientSecretCiphertextB64, 'base64');
        const oldNonce = Buffer.from(cred.clientSecretNonceB64, 'base64');
        // Decrypt with current env key (source was same env on wipe-then-restore),
        // then re-encrypt so ciphertext/nonce always change.
        const plaintext = this.secrets.decrypt(oldCipher, oldNonce);
        const re = this.secrets.encrypt(plaintext);
        await tx.tenantEtaCredential.create({
          data: {
            id: cred.id,
            tenantId: targetTenantId,
            branchId: cred.branchId,
            clientId: cred.clientId,
            clientSecretCiphertext: Buffer.from(re.ciphertext),
            clientSecretNonce: Buffer.from(re.nonce),
            registrationNumber: cred.registrationNumber,
            activityCode: cred.activityCode,
            isIntermediary: cred.isIntermediary,
            onBehalfOfRegistrationNumber: cred.onBehalfOfRegistrationNumber,
            onBehalfOfName: cred.onBehalfOfName,
          },
        });
      }

      for (const item of payload.itemCodes) {
        await tx.itemCode.create({
          data: {
            id: String(item.id),
            tenantId: targetTenantId,
            type: item.type as ItemCodeType,
            code: String(item.code),
            description: String(item.description),
            isActive: Boolean(item.isActive ?? true),
            source: (item.source as ItemCodeSource) ?? ItemCodeSource.LOCAL,
          },
        });
      }
    });
  }
}
