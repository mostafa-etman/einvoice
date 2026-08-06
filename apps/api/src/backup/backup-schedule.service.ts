import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

const CRON_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

@Injectable()
export class BackupScheduleService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.tenantBackupSchedule.findUnique({ where: { tenantId } }),
    );
    if (!row) throw new NotFoundException('schedule_not_found');
    return row;
  }

  async upsert(input: {
    tenantId: string;
    userId: string;
    cronExpression: string;
    timezone: string;
    paused?: boolean;
  }) {
    if (!CRON_RE.test(input.cronExpression.trim())) {
      throw new BadRequestException('invalid_cron');
    }
    const nextRunAt = new Date(Date.now() + 60_000);
    const row = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantBackupSchedule.upsert({
        where: { tenantId: input.tenantId },
        create: {
          tenantId: input.tenantId,
          cronExpression: input.cronExpression.trim(),
          timezone: input.timezone || 'Africa/Cairo',
          paused: Boolean(input.paused),
          nextRunAt,
          createdByUserId: input.userId,
        },
        update: {
          cronExpression: input.cronExpression.trim(),
          timezone: input.timezone || 'Africa/Cairo',
          paused: Boolean(input.paused),
          nextRunAt,
        },
      }),
    );
    await this.audit.write({
      action: 'backup.schedule',
      outcome: 'success',
      actorUserId: input.userId,
      tenantId: input.tenantId,
      resourceType: 'TenantBackupSchedule',
      resourceId: row.id,
    });
    return row;
  }
}
