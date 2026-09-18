import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FeedbackStatus, Prisma } from '@prisma/client';
import { isAppScreenKey, matchAppScreen, stripLocalePrefix } from '@einvoice/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PLATFORM_AUDIT_ACTIONS } from '../platform-admin/platform-audit';

const NOTE_MAX = 8000;
const ROUTE_MAX = 500;

export type SubmitFeedbackInput = {
  tenantId: string;
  userId: string;
  screenKey?: string;
  routePath?: string;
  note: string;
};

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(input: SubmitFeedbackInput) {
    const note = input.note?.trim() ?? '';
    if (!note) throw new BadRequestException('note_required');
    if (note.length > NOTE_MAX) throw new BadRequestException('note_too_long');

    const routePath = stripLocalePrefix((input.routePath ?? '/').trim()).slice(0, ROUTE_MAX);
    const screenKey = input.screenKey?.trim()
      ? input.screenKey.trim()
      : matchAppScreen(routePath);
    if (!isAppScreenKey(screenKey)) {
      throw new BadRequestException('invalid_screen');
    }

    const [tenant, author] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: input.tenantId },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, name: true },
      }),
    ]);
    if (!tenant) throw new NotFoundException('tenant_not_found');
    if (!author) throw new NotFoundException('user_not_found');

    const row = await this.tenantPrisma.withTenant(input.tenantId, (tx) =>
      tx.tenantScreenFeedback.create({
        data: {
          tenantId: input.tenantId,
          tenantNameSnapshot: tenant.name,
          authorUserId: author.id,
          authorEmailSnapshot: author.email,
          authorNameSnapshot: author.name,
          screenKey,
          routePath,
          note,
          status: 'NEW',
        },
      }),
    );

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.FEEDBACK_SUBMIT,
      outcome: 'success',
      actorUserId: input.userId,
      tenantId: input.tenantId,
      resourceType: 'tenant_screen_feedback',
      resourceId: row.id,
      metadata: { screenKey },
    });

    return this.toView(row);
  }

  async list(query: {
    tenantId?: string;
    screenKey?: string;
    status?: FeedbackStatus;
    q?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const term = query.q?.trim();
    const where: Prisma.TenantScreenFeedbackWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.screenKey) where.screenKey = query.screenKey;
    if (query.status) where.status = query.status;
    if (term) {
      where.OR = [
        { note: { contains: term, mode: 'insensitive' } },
        { tenantNameSnapshot: { contains: term, mode: 'insensitive' } },
        { authorEmailSnapshot: { contains: term, mode: 'insensitive' } },
        { authorNameSnapshot: { contains: term, mode: 'insensitive' } },
        { routePath: { contains: term, mode: 'insensitive' } },
        { screenKey: { contains: term, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.tenantScreenFeedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.toView(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async summary() {
    const newCount = await this.prisma.tenantScreenFeedback.count({
      where: { status: 'NEW' },
    });
    return { newCount };
  }

  async setStatus(id: string, status: FeedbackStatus, operatorUserId: string) {
    if (status !== 'NEW' && status !== 'REVIEWED' && status !== 'RESOLVED') {
      throw new BadRequestException('invalid_status');
    }
    const existing = await this.prisma.tenantScreenFeedback.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('feedback_not_found');

    const reviewed = status === 'NEW' ? { reviewedAt: null, reviewedByUserId: null } : {
      reviewedAt: existing.reviewedAt ?? new Date(),
      reviewedByUserId: existing.reviewedByUserId ?? operatorUserId,
    };

    const row = await this.prisma.tenantScreenFeedback.update({
      where: { id },
      data: { status, ...reviewed },
    });

    await this.audit.write({
      action: PLATFORM_AUDIT_ACTIONS.FEEDBACK_STATUS,
      outcome: 'success',
      actorUserId: operatorUserId,
      tenantId: row.tenantId,
      resourceType: 'tenant_screen_feedback',
      resourceId: row.id,
      metadata: { status },
    });

    return this.toView(row);
  }

  private toView(row: {
    id: string;
    tenantId: string;
    tenantNameSnapshot: string;
    authorUserId: string;
    authorEmailSnapshot: string;
    authorNameSnapshot: string | null;
    screenKey: string;
    routePath: string;
    note: string;
    status: FeedbackStatus;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt: Date | null;
    reviewedByUserId: string | null;
  }) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenantNameSnapshot,
      authorUserId: row.authorUserId,
      authorEmail: row.authorEmailSnapshot,
      authorName: row.authorNameSnapshot,
      screenKey: row.screenKey,
      routePath: row.routePath,
      note: row.note,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedByUserId: row.reviewedByUserId,
    };
  }
}
