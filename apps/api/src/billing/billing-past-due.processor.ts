import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { loadEnv, shouldRunInProcessCrons } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QUEUE_BILLING_PAST_DUE } from '../queues/queue-names';
import { BILLING_AUDIT_ACTIONS } from './billing-audit';

/**
 * Past-due grace sweep (013-saas-layer T057): tenants whose subscription is
 * PAST_DUE with an expired `graceEndsAt` move to READ_ONLY, which blocks
 * writes everywhere except the billing self-heal routes (tenant-access.guard.ts).
 */
@Processor(QUEUE_BILLING_PAST_DUE)
export class BillingPastDueProcessor extends WorkerHost {
  private readonly log = new Logger(BillingPastDueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(_job: Job<{ tick: true }>): Promise<void> {
    await this.sweep();
  }

  /**
   * Exported for direct/unit invocation (bypasses the queue).
   *
   * `Subscription` is FORCE-RLS'd per tenant, so there is no single
   * cross-tenant query for "all expired PAST_DUE rows" — instead this walks
   * every tenant and checks its subscription under that tenant's own RLS
   * context (same pattern as `TenantLifecycleService` / usage-rollup sweep).
   */
  async sweep(now: Date = new Date()): Promise<{ movedTenantIds: string[] }> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
      take: 5000,
    });

    const movedTenantIds: string[] = [];
    for (const { id: tenantId } of tenants) {
      try {
        const subscription = await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.subscription.findUnique({ where: { tenantId }, select: { status: true, graceEndsAt: true } }),
        );
        if (subscription?.status !== 'PAST_DUE' || !subscription.graceEndsAt || subscription.graceEndsAt >= now) {
          continue;
        }

        await this.tenantPrisma.withTenant(tenantId, (tx) =>
          tx.subscription.updateMany({
            where: { tenantId, status: 'PAST_DUE', graceEndsAt: { lt: now } },
            data: { status: 'READ_ONLY' },
          }),
        );
        await this.audit.write({
          action: BILLING_AUDIT_ACTIONS.PAST_DUE_READ_ONLY,
          outcome: 'success',
          tenantId,
          resourceType: 'subscription',
          resourceId: tenantId,
          metadata: { reason: 'grace_period_expired' },
        });
        movedTenantIds.push(tenantId);
      } catch (e) {
        this.log.warn(`past-due sweep failed tenant=${tenantId}: ${String(e)}`);
      }
    }

    if (movedTenantIds.length > 0) {
      this.log.log(`past-due sweep moved ${movedTenantIds.length} tenant(s) to READ_ONLY`);
    }
    return { movedTenantIds };
  }
}

/** Enqueues the past-due grace sweep on a configurable interval. */
@Injectable()
export class BillingPastDueScheduler implements OnModuleInit {
  private readonly log = new Logger(BillingPastDueScheduler.name);

  constructor(
    @InjectQueue(QUEUE_BILLING_PAST_DUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    const env = loadEnv();
    // Avoid Redis schedulers / open handles that hang Jest teardown.
    if (env.NODE_ENV === 'test') {
      this.log.log('Skipping billing-past-due scheduler in test env');
      return;
    }
    if (!shouldRunInProcessCrons(env)) {
      this.log.log('Skipping billing-past-due scheduler (APP_ROLE=api)');
      return;
    }
    const every = Math.max(60_000, env.BILLING_PAST_DUE_SWEEP_INTERVAL_MS);
    await this.queue.upsertJobScheduler(
      'billing-past-due-repeat',
      { every },
      {
        name: 'billing-past-due-tick',
        data: { tick: true },
        opts: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      },
    );
    this.log.log(`Scheduled billing-past-due sweep every ${every}ms`);
  }
}
