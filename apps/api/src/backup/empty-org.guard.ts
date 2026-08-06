import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Empty = org shell + membership only (no operational business data).
 * Operational: documents, purchases, ETA creds, item codes, stored artifacts, etc.
 */
@Injectable()
export class EmptyOrgGuard {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async assertEmpty(tenantId: string): Promise<{ empty: boolean; reason?: string }> {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const docCount = await tx.document.count({ where: { tenantId } });
      if (docCount > 0) return { empty: false, reason: 'documents_present' };

      const recvCount = await tx.receivedDocument.count({ where: { tenantId } });
      if (recvCount > 0) return { empty: false, reason: 'purchases_present' };

      const artCount = await tx.documentArtifact.count({ where: { tenantId } });
      if (artCount > 0) return { empty: false, reason: 'stored_files_present' };

      const etaCount = await tx.tenantEtaCredential.count({ where: { tenantId } });
      if (etaCount > 0) return { empty: false, reason: 'eta_credentials_present' };

      const itemCount = await tx.itemCode.count({ where: { tenantId } });
      if (itemCount > 0) return { empty: false, reason: 'settings_item_codes_present' };

      return { empty: true };
    });
  }

  /** Wipe operational business data for same-tenant wipe-then-restore (tests / DR prep). */
  async wipeOperationalData(tenantId: string): Promise<void> {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.documentArtifact.deleteMany({ where: { tenantId } });
      await tx.documentLine.deleteMany({ where: { document: { tenantId } } });
      await tx.document.deleteMany({ where: { tenantId } });
      await tx.receivedDocumentLine.deleteMany({
        where: { receivedDocument: { tenantId } },
      });
      await tx.receivedDocument.deleteMany({ where: { tenantId } });
      await tx.tenantEtaCredential.deleteMany({ where: { tenantId } });
      await tx.itemCode.deleteMany({ where: { tenantId } });
    });
  }
}
