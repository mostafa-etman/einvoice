import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  QUEUE_USAGE_ROLLUP,
  QUEUE_USAGE_EXPORT,
  type UsageRollupJobData,
  type UsageExportJobData,
} from '../queues/queue-names';
import { UsageRollupService } from './usage-rollup.service';
import { UsageExportService } from './usage-export.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv, shouldRunInProcessCrons } from '../config/env';
import { bucketDateInTz } from './usage-aggregate';

@Processor(QUEUE_USAGE_ROLLUP)
export class UsageRollupProcessor extends WorkerHost {
  private readonly log = new Logger(UsageRollupProcessor.name);

  constructor(
    private readonly rollups: UsageRollupService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(
    job: Job<UsageRollupJobData | { kind: 'tick' }>,
  ): Promise<void> {
    const data = job.data as Partial<UsageRollupJobData> & { kind?: string };
    if (data.kind === 'tick' || !data.tenantId) {
      await this.rollupAllTenants();
      return;
    }
    this.log.log(
      `rollup tenant=${data.tenantId} ${data.fromDate}..${data.toDate}`,
    );
    await this.rollups.rebuildRange({
      tenantId: data.tenantId,
      fromDate: data.fromDate!,
      toDate: data.toDate!,
      timeZone: data.timeZone,
    });
  }

  private async rollupAllTenants() {
    const env = loadEnv();
    const tz = env.USAGE_METERING_TIMEZONE;
    const today = bucketDateInTz(new Date(), tz);
    const from = new Date(`${today}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - 40);
    const fromDate = from.toISOString().slice(0, 10);

    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
      take: 5000,
    });
    this.log.log(`rollup tick tenants=${tenants.length} ${fromDate}..${today}`);
    for (const t of tenants) {
      try {
        await this.rollups.rebuildRange({
          tenantId: t.id,
          fromDate,
          toDate: today,
          timeZone: tz,
        });
      } catch (e) {
        this.log.warn(`rollup failed tenant=${t.id}: ${String(e)}`);
      }
    }
  }
}

@Processor(QUEUE_USAGE_EXPORT)
export class UsageExportProcessor extends WorkerHost {
  private readonly log = new Logger(UsageExportProcessor.name);
  constructor(private readonly exports: UsageExportService) {
    super();
  }
  async process(job: Job<UsageExportJobData>): Promise<void> {
    this.log.log(`usage-export ${job.data.usageExportJobId}`);
    await this.exports.processExport(
      job.data.tenantId,
      job.data.usageExportJobId,
    );
  }
}

/** Enqueues per-tenant rollup rebuilds on a configurable interval. */
@Injectable()
export class UsageRollupScheduler implements OnModuleInit {
  private readonly log = new Logger(UsageRollupScheduler.name);

  constructor(
    @InjectQueue(QUEUE_USAGE_ROLLUP) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    const env = loadEnv();
    // Avoid Redis schedulers / open handles that hang Jest teardown.
    if (env.NODE_ENV === 'test') {
      this.log.log('Skipping usage-rollup scheduler in test env');
      return;
    }
    if (!shouldRunInProcessCrons(env)) {
      this.log.log('Skipping usage-rollup scheduler (APP_ROLE=api)');
      return;
    }
    const every = Math.max(60_000, env.USAGE_ROLLUP_INTERVAL_MS);
    await this.queue.upsertJobScheduler(
      'usage-rollup-repeat',
      { every },
      {
        name: 'usage-rollup-tick',
        data: { kind: 'tick' },
        opts: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
    this.log.log(`Scheduled usage-rollup every ${every}ms`);
  }
}
