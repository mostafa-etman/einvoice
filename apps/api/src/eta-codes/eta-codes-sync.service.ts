import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Refresh / sync mechanism for ETA code tables.
 *
 * Offline path (no credentials): re-seed from committed SDK JSON under
 * `apps/api/data/eta-codes` (or re-download via `eta:codes:refresh-sdk`).
 *
 * Online path (credentials required later): EGS/GS1 published item codes via
 * `GET /api/v1.0/codetypes/{GS1|EGS}/codes` — stubbed here until submit-time
 * credentials are configured.
 */
@Injectable()
export class EtaCodesSyncService {
  private readonly logger = new Logger(EtaCodesSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks catalogs as needing an online EGS/GS1 sync. Static tax/UOM/currency
   * tables do not use this path — they come from public SDK `/files/` JSON.
   */
  async requestItemCodeCatalogSync(tenantId: string): Promise<{
    status: 'use_tenant_sync';
    reason: string;
    endpoint: string;
  }> {
    this.logger.log(
      `Item-code catalog sync for tenant ${tenantId} — use POST /item-codes/sync`,
    );
    return {
      status: 'use_tenant_sync',
      reason:
        'Tenant EGS/GS1 published codes sync via authenticated Search Published Codes. ' +
        'Call POST /item-codes/sync (settings.item_codes.manage).',
      endpoint: 'POST /item-codes/sync',
    };
  }

  async catalogSyncStatus() {
    const catalogs = await this.prisma.etaCodeCatalog.findMany({
      orderBy: { kind: 'asc' },
      select: {
        kind: true,
        contentHash: true,
        entryCount: true,
        lastSeededAt: true,
        lastSyncedAt: true,
        syncStatus: true,
        syncNotes: true,
        sourceUrl: true,
      },
    });
    return {
      offlineSeedReady: catalogs.length > 0,
      catalogs,
      onlineItemCodes: {
        status: 'not_configured',
        note: 'Connect ETA credentials later; then call Search Published Codes for EGS/GS1.',
      },
    };
  }
}
