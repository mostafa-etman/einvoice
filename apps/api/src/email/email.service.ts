import { Injectable, Logger } from '@nestjs/common';
import type { EmailOutbox, EmailOutboxStatus, EmailTemplate, Prisma } from '@prisma/client';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type EnqueueOrSendInput = {
  template: EmailTemplate;
  tenantId?: string | null;
  toEmail: string;
  locale: string;
  /** Unique across all sends, e.g. `quota_warn:80:tenant-id:2026-08` — dedupes repeat lifecycle emails. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
};

export type EnqueueOrSendResult = {
  status: EmailOutboxStatus;
  /** true when an EmailOutbox row with this dedupeKey already existed — nothing new was sent. */
  skipped: boolean;
  outboxId: string;
};

/**
 * Transactional email abstraction (research.md R7). Console transport by default;
 * SMTP/provider transports can plug into `send()` later without touching callers.
 * Never logs secrets — payloadJson must only ever contain non-secret template vars.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueueOrSend(input: EnqueueOrSendInput): Promise<EnqueueOrSendResult> {
    const existing = await this.prisma.emailOutbox.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) {
      return { status: existing.status, skipped: true, outboxId: existing.id };
    }

    const record = await this.prisma.emailOutbox.create({
      data: {
        tenantId: input.tenantId ?? undefined,
        template: input.template,
        locale: input.locale,
        toEmail: input.toEmail,
        dedupeKey: input.dedupeKey,
        status: 'PENDING',
        payloadJson: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });

    try {
      await this.send(record);
      await this.prisma.emailOutbox.update({
        where: { id: record.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
      return { status: 'SENT', skipped: false, outboxId: record.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.emailOutbox.update({
        where: { id: record.id },
        data: { status: 'FAILED', error: message },
      });
      return { status: 'FAILED', skipped: false, outboxId: record.id };
    }
  }

  private async send(record: EmailOutbox): Promise<void> {
    const transport = loadEnv().EMAIL_TRANSPORT;
    if (transport !== 'console') {
      this.logger.warn(
        `EMAIL_TRANSPORT=${transport} is not implemented yet; falling back to console log`,
      );
    }
    this.logger.log(
      `[email:${record.template}] to=${record.toEmail} locale=${record.locale} dedupeKey=${record.dedupeKey}`,
    );
  }
}
