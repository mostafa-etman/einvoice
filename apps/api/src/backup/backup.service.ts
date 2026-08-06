import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { loadEnv } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { QUEUE_BACKUP, type BackupJobData } from '../queues/queue-names';
import { BackupArchiveService } from './backup-archive.service';

@Injectable()
export class BackupService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly archive: BackupArchiveService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_BACKUP) private readonly backupQueue: Queue<BackupJobData>,
  ) {}

  async createBackup(input: {
    tenantId: string;
    userId: string;
    triggerSource?: 'MANUAL' | 'SCHEDULE';
    scheduleId?: string;
  }) {
    const active = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantBackupJob.findFirst({
        where: {
          tenantId: input.tenantId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
      }),
    );
    if (active) {
      throw new ConflictException('backup_already_running');
    }

    const job = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantBackupJob.create({
        data: {
          tenantId: input.tenantId,
          status: 'QUEUED',
          triggerSource: input.triggerSource ?? 'MANUAL',
          scheduleId: input.scheduleId,
          createdByUserId: input.userId,
        },
      }),
    );

    await this.audit.write({
      action: 'backup.create',
      outcome: 'accepted',
      actorUserId: input.userId,
      tenantId: input.tenantId,
      resourceType: 'TenantBackupJob',
      resourceId: job.id,
    });

    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      await this.processBackupJob(job.id, input.tenantId);
      return this.getJob(input.tenantId, job.id);
    }

    await this.backupQueue.add(
      'backup',
      { tenantId: input.tenantId, backupJobId: job.id },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
    return job;
  }

  async processBackupJob(jobId: string, tenantId: string) {
    await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantBackupJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      const stored = await this.archive.buildAndStore(tenantId, jobId);
      const ttlDays = loadEnv().BACKUP_ARTIFACT_TTL_DAYS;
      const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
      const done = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.tenantBackupJob.update({
          where: { id: jobId },
          data: {
            status: 'COMPLETED',
            objectKey: stored.objectKey,
            byteSize: BigInt(stored.byteSize),
            checksumSha256: stored.checksumSha256,
            completedAt: new Date(),
            expiresAt,
            errorCode: null,
            errorMessage: null,
          },
        }),
      );
      await this.audit.write({
        action: 'backup.create',
        outcome: 'success',
        tenantId,
        resourceType: 'TenantBackupJob',
        resourceId: jobId,
      });
      return done;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'backup_failed';
      await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.tenantBackupJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorCode: 'backup_failed',
            errorMessage: 'backup_failed',
            completedAt: new Date(),
          },
        }),
      );
      await this.audit.write({
        action: 'backup.create',
        outcome: 'failure',
        tenantId,
        resourceType: 'TenantBackupJob',
        resourceId: jobId,
        metadata: { error: msg.slice(0, 120) },
      });
      throw err;
    }
  }

  async listJobs(tenantId: string, limit = 20) {
    return this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantBackupJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
      }),
    );
  }

  async getJob(tenantId: string, jobId: string) {
    const job = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantBackupJob.findFirst({ where: { id: jobId, tenantId } }),
    );
    if (!job) throw new NotFoundException('backup_job_not_found');
    return job;
  }

  async download(
    tenantId: string,
    jobId: string,
    userId: string,
    getByKey: (key: string) => Promise<Buffer>,
  ) {
    const job = await this.getJob(tenantId, jobId);
    if (job.status !== 'COMPLETED' || !job.objectKey) {
      throw new NotFoundException('backup_not_downloadable');
    }
    const body = await getByKey(job.objectKey);
    await this.audit.write({
      action: 'backup.download',
      outcome: 'success',
      actorUserId: userId,
      tenantId,
      resourceType: 'TenantBackupJob',
      resourceId: jobId,
    });
    return {
      body,
      checksumSha256: job.checksumSha256,
      byteSize: job.byteSize,
    };
  }

  serializeJob(job: {
    id: string;
    tenantId: string;
    status: string;
    triggerSource: string;
    byteSize: bigint | null;
    checksumSha256: string | null;
    schemaVersion: string;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: job.id,
      tenantId: job.tenantId,
      status: job.status,
      triggerSource: job.triggerSource,
      byteSize: job.byteSize != null ? Number(job.byteSize) : null,
      checksumSha256: job.checksumSha256,
      schemaVersion: job.schemaVersion,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }
}
