import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildPairingCode, hashSecretToken } from './token.util';

const PAIRING_TTL_MINUTES = 30;

export type PairingCodeSummary = {
  id: string;
  status: string;
  codeHint: string | null;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

@Injectable()
export class PairingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCode(tenantId: string, actorUserId: string) {
    const { code, hash, hint } = buildPairingCode(tenantId);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000);

    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pairingCode.create({
        data: {
          tenantId,
          codeHash: hash,
          codeHint: hint,
          status: 'ACTIVE',
          expiresAt,
          createdByUserId: actorUserId,
        },
      }),
    );

    await this.audit.write({
      action: 'devices.pairing.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'pairing_code',
      resourceId: row.id,
      metadata: { expiresAt: row.expiresAt.toISOString() },
    });

    return { id: row.id, code, expiresAt: row.expiresAt.toISOString() };
  }

  async list(tenantId: string): Promise<PairingCodeSummary[]> {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.pairingCode.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      codeHint: row.codeHint,
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async revoke(tenantId: string, actorUserId: string, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const row = await tx.pairingCode.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Pairing code not found');
      if (row.status !== 'ACTIVE') {
        throw new BadRequestException('Pairing code is not active');
      }
      await tx.pairingCode.update({ where: { id }, data: { status: 'REVOKED' } });
    });

    await this.audit.write({
      action: 'devices.pairing.revoke',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'pairing_code',
      resourceId: id,
      metadata: {},
    });
  }

  /** Only used internally to validate a raw code's hash against a fetched row. */
  matchesHash(rawCode: string, storedHash: string): boolean {
    return hashSecretToken(rawCode) === storedHash;
  }
}
