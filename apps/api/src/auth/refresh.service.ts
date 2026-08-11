import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshService {
  constructor(private readonly prisma: PrismaService) {}

  createRawToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async issue(
    userId: string,
    ttlDays: number,
    activeTenantId?: string | null,
  ): Promise<{ raw: string; expiresAt: Date }> {
    const raw = this.createRawToken();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: this.hashToken(raw),
        expiresAt,
        activeTenantId: activeTenantId ?? null,
      },
    });
    return { raw, expiresAt };
  }

  /** Rotate on use: revoke old, create new. Reuse of old hash fails. */
  async rotate(
    raw: string,
    ttlDays: number,
  ): Promise<{
    userId: string;
    raw: string;
    expiresAt: Date;
    activeTenantId: string | null;
  }> {
    const tokenHash = this.hashToken(raw);
    const existing = await this.prisma.refreshSession.findFirst({
      where: { tokenHash },
    });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRaw = this.createRawToken();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.refreshSession.create({
        data: {
          userId: existing.userId,
          tokenHash: this.hashToken(newRaw),
          expiresAt,
          activeTenantId: existing.activeTenantId,
        },
      });
      await tx.refreshSession.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      return next;
    });

    return {
      userId: created.userId,
      raw: newRaw,
      expiresAt,
      activeTenantId: created.activeTenantId,
    };
  }

  async setActiveTenant(raw: string, tenantId: string): Promise<void> {
    const tokenHash = this.hashToken(raw);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { activeTenantId: tenantId },
    });
  }

  async revoke(raw: string): Promise<void> {
    const tokenHash = this.hashToken(raw);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
