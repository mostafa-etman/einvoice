import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { tenantArtifactKey } from '../storage/minio-artifact.store';
import {
  decryptArchivePacked,
  encryptArchive,
  packEncryptedArchive,
  sha256Hex,
  verifyChecksum,
} from './backup-crypto';
import { BACKUP_TABLE_INVENTORY } from './backup-table-inventory';

export type BackupArchivePayload = {
  schemaVersion: string;
  sourceTenantId: string;
  createdAt: string;
  tables: typeof BACKUP_TABLE_INVENTORY;
  documents: Array<Record<string, unknown>>;
  documentLines: Array<Record<string, unknown>>;
  artifacts: Array<{
    id: string;
    documentId: string | null;
    kind: string;
    minioBucket: string;
    minioKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    bodyBase64: string;
  }>;
  etaCredentials: Array<{
    id: string;
    branchId: string | null;
    clientId: string;
    clientSecretCiphertextB64: string;
    clientSecretNonceB64: string;
    registrationNumber: string | null;
    activityCode: string | null;
    isIntermediary: boolean;
    onBehalfOfRegistrationNumber: string | null;
    onBehalfOfName: string | null;
  }>;
  itemCodes: Array<Record<string, unknown>>;
};

type ArtifactStorage = {
  put: (input: {
    tenantId: string;
    kind: string;
    objectId: string;
    contentType: string;
    body: Buffer;
  }) => Promise<{ key: string; byteSize: number }>;
  getByKey: (key: string) => Promise<Buffer>;
  putByKey: (
    key: string,
    body: Buffer,
    contentType: string,
  ) => Promise<{ key: string; byteSize: number }>;
};

@Injectable()
export class BackupArchiveService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject('ArtifactStorage') private readonly artifacts: ArtifactStorage,
  ) {}

  async buildAndStore(tenantId: string, jobId: string): Promise<{
    objectKey: string;
    byteSize: number;
    checksumSha256: string;
    payload: BackupArchivePayload;
  }> {
    const payload = await this.buildPayload(tenantId);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const enc = await encryptArchive(plaintext);
    const packed = packEncryptedArchive(enc);
    const stored = await this.artifacts.put({
      tenantId,
      kind: 'backups',
      objectId: `${jobId}.bin`,
      contentType: 'application/octet-stream',
      body: packed,
    });
    return {
      objectKey: stored.key,
      byteSize: packed.byteLength,
      checksumSha256: enc.checksumSha256,
      payload,
    };
  }

  async loadAndDecrypt(
    objectKey: string,
    expectedChecksum: string,
  ): Promise<BackupArchivePayload> {
    const packed = await this.artifacts.getByKey(objectKey);
    if (!verifyChecksum(packed, expectedChecksum)) {
      throw new Error('CHECKSUM_MISMATCH');
    }
    const plaintext = await decryptArchivePacked(packed);
    return JSON.parse(plaintext.toString('utf8')) as BackupArchivePayload;
  }

  /** Server-side open+decrypt for isolation asserts (no restore). */
  async peekPayload(
    objectKey: string,
    expectedChecksum: string,
  ): Promise<BackupArchivePayload> {
    return this.loadAndDecrypt(objectKey, expectedChecksum);
  }

  private async buildPayload(tenantId: string): Promise<BackupArchivePayload> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const documents = await tx.document.findMany({ where: { tenantId } });
      const documentLines = await tx.documentLine.findMany({
        where: { document: { tenantId } },
      });
      const artifactRows = await tx.documentArtifact.findMany({
        where: { tenantId },
      });
      const etaCredentials = await tx.tenantEtaCredential.findMany({
        where: { tenantId },
      });
      const itemCodes = await tx.itemCode.findMany({ where: { tenantId } });

      const artifacts: BackupArchivePayload['artifacts'] = [];
      for (const a of artifactRows) {
        let body: Buffer;
        try {
          body = await this.artifacts.getByKey(a.minioKey);
        } catch {
          body = Buffer.alloc(0);
        }
        artifacts.push({
          id: a.id,
          documentId: a.documentId,
          kind: a.kind,
          minioBucket: a.minioBucket,
          minioKey: a.minioKey,
          contentType: a.contentType,
          byteSize: a.byteSize,
          sha256: sha256Hex(body),
          bodyBase64: body.toString('base64'),
        });
      }

      return {
        schemaVersion: '1',
        sourceTenantId: tenantId,
        createdAt: new Date().toISOString(),
        tables: BACKUP_TABLE_INVENTORY,
        documents: documents.map((d) => this.jsonSafe(d)),
        documentLines: documentLines.map((l) => this.jsonSafe(l)),
        artifacts,
        etaCredentials: etaCredentials.map((c) => ({
          id: c.id,
          branchId: c.branchId,
          clientId: c.clientId,
          clientSecretCiphertextB64: Buffer.from(c.clientSecretCiphertext).toString(
            'base64',
          ),
          clientSecretNonceB64: Buffer.from(c.clientSecretNonce).toString('base64'),
          registrationNumber: c.registrationNumber,
          activityCode: c.activityCode,
          isIntermediary: c.isIntermediary,
          onBehalfOfRegistrationNumber: c.onBehalfOfRegistrationNumber,
          onBehalfOfName: c.onBehalfOfName,
        })),
        itemCodes: itemCodes.map((i) => this.jsonSafe(i)),
      };
    });
  }

  private jsonSafe(row: Record<string, unknown> | object): Record<string, unknown> {
    return JSON.parse(
      JSON.stringify(row, (_k, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (Buffer.isBuffer(v)) return { __buf: v.toString('base64') };
        return v;
      }),
    ) as Record<string, unknown>;
  }

  /** Hash helper for tests. */
  fileSha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  backupObjectKey(tenantId: string, jobId: string): string {
    return tenantArtifactKey(tenantId, 'backups', `${jobId}.bin`);
  }
}
