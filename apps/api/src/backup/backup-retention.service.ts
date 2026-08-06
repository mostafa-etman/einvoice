import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BackupRetentionService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  /** Keep last N scheduled OR expire older than D days (both limits). */
  async enforceForTenant(tenantId: string): Promise<number> {
    const env = loadEnv();
    const keepLast = env.BACKUP_RETENTION_KEEP_LAST;
    const days = env.BACKUP_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 86400_000);

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const scheduled = await tx.tenantBackupJob.findMany({
        where: {
          tenantId,
          triggerSource: 'SCHEDULE',
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
      });

      let expired = 0;
      scheduled.forEach((job, idx) => {
        const overCount = idx >= keepLast;
        const overAge = job.createdAt < cutoff;
        if (overCount || overAge) {
          void tx.tenantBackupJob.update({
            where: { id: job.id },
            data: { status: 'EXPIRED' },
          });
          expired += 1;
        }
      });
      return expired;
    });
  }

  async enforceAll(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      await this.enforceForTenant(t.id);
    }
  }
}
