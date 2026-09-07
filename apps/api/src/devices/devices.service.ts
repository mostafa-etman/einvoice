import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, SigningDevice } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { QuotaService } from '../billing/quota.service';
import {
  buildDeviceToken,
  hashSecretToken,
  parseTenantPrefixedToken,
  unusableTokenHash,
} from './token.util';

export type DeviceSummary = {
  id: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  pairedAt: string;
  revokedAt: string | null;
  ready: Prisma.JsonValue | null;
};

function toSummary(device: SigningDevice): DeviceSummary {
  return {
    id: device.id,
    label: device.label,
    status: device.status,
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    pairedAt: device.pairedAt.toISOString(),
    revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
    ready: device.lastReadyJson ?? null,
  };
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
  ) {}

  async list(tenantId: string): Promise<DeviceSummary[]> {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.signingDevice.findMany({ where: { tenantId }, orderBy: { pairedAt: 'desc' } }),
    );
    return rows.map(toSummary);
  }

  async rename(tenantId: string, actorUserId: string, id: string, label: string) {
    if (!label?.trim()) throw new BadRequestException('label is required');

    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.signingDevice.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Device not found');
      return tx.signingDevice.update({ where: { id }, data: { label } });
    });

    await this.audit.write({
      action: 'devices.device.rename',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'signing_device',
      resourceId: id,
      metadata: { label },
    });

    return toSummary(updated);
  }

  async unpair(tenantId: string, actorUserId: string | null, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.signingDevice.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Device not found');
      if (existing.status === 'REVOKED') return;
      await tx.signingDevice.update({
        where: { id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          // Clear/rotate so no possible bearer token can match this device again.
          tokenHash: unusableTokenHash(),
        },
      });
    });

    await this.audit.write({
      action: 'devices.device.unpair',
      outcome: 'success',
      actorUserId: actorUserId ?? undefined,
      tenantId,
      resourceType: 'signing_device',
      resourceId: id,
      metadata: { source: actorUserId ? 'admin' : 'agent' },
    });
  }

  /**
   * Consumes a pairing code and registers a device. The issued device token is
   * long-lived (expiresAt / tokenExpiresAt stay null) until explicit unpair.
   * The same machineFingerprint on an already-PAIRED row reuses that device
   * instead of creating a second seat.
   */
  async pairAgent(input: {
    pairingCode: string;
    label: string;
    machineFingerprint?: string;
  }) {
    const parts = parseTenantPrefixedToken(input.pairingCode, 2);
    if (!parts) throw new BadRequestException('Invalid pairing code');
    const [tenantId] = parts;
    const codeHash = hashSecretToken(input.pairingCode);
    if (!input.label?.trim()) throw new BadRequestException('label is required');

    await this.quota.checkTenantWritable(tenantId!);

    const fingerprint = input.machineFingerprint?.trim() || undefined;
    const existing = fingerprint
      ? await this.tenantPrisma.withTenant(tenantId!, (tx) =>
          tx.signingDevice.findFirst({
            where: { tenantId, machineFingerprint: fingerprint, status: 'PAIRED' },
          }),
        )
      : null;

    // Returning the same PC reuses the long-lived device row (no extra quota seat).
    if (!existing) {
      await this.quota.assertWithinLimits(tenantId!, 'devices');
    }

    const result = await this.tenantPrisma.withTenant(tenantId!, async (tx) => {
      const code = await tx.pairingCode.findFirst({ where: { tenantId, codeHash } });
      if (!code) throw new BadRequestException('Invalid pairing code');
      if (code.status === 'CONSUMED') {
        throw new BadRequestException('Pairing code already used');
      }
      if (code.status === 'REVOKED') {
        throw new BadRequestException('Pairing code revoked');
      }
      if (code.status === 'EXPIRED' || code.expiresAt.getTime() < Date.now()) {
        if (code.status === 'ACTIVE') {
          await tx.pairingCode.update({ where: { id: code.id }, data: { status: 'EXPIRED' } });
        }
        throw new BadRequestException('Pairing code expired');
      }

      const deviceId = existing?.id ?? randomUUID();
      const { token, hash } = buildDeviceToken(tenantId!, deviceId);

      const device = existing
        ? await tx.signingDevice.update({
            where: { id: existing.id },
            data: {
              label: input.label,
              machineFingerprint: fingerprint,
              status: 'PAIRED',
              tokenHash: hash,
              tokenExpiresAt: null,
              revokedAt: null,
              lastSeenAt: new Date(),
            },
          })
        : await tx.signingDevice.create({
            data: {
              id: deviceId,
              tenantId: tenantId!,
              label: input.label,
              machineFingerprint: fingerprint,
              status: 'PAIRED',
              tokenHash: hash,
              tokenExpiresAt: null,
              pairedAt: new Date(),
            },
          });

      await tx.pairingCode.update({
        where: { id: code.id },
        data: { status: 'CONSUMED', consumedAt: new Date(), consumedByDeviceId: device.id },
      });

      return { device, token, resumed: Boolean(existing) };
    });

    await this.audit.write({
      action: 'devices.pairing.consume',
      outcome: 'success',
      tenantId,
      resourceType: 'signing_device',
      resourceId: result.device.id,
      metadata: { label: result.device.label, resumed: result.resumed },
    });

    return {
      deviceId: result.device.id,
      deviceToken: result.token,
      tenantId,
      expiresAt: null,
      resumed: result.resumed,
    };
  }

  async heartbeat(device: SigningDevice, ready?: Record<string, unknown>) {
    await this.tenantPrisma.withTenant(device.tenantId, (tx) =>
      tx.signingDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          // Live paired devices stay registered until explicit unpair/revoke.
          tokenExpiresAt: null,
          ...(ready ? { lastReadyJson: ready as Prisma.InputJsonValue } : {}),
        },
      }),
    );
    return {
      ok: true,
      deviceId: device.id,
      tenantId: device.tenantId,
      status: device.status,
    };
  }

  /**
   * Resolves a device by its bearer token; throws 401 if invalid, revoked, or unknown.
   * Device tokens are long-lived (tokenExpiresAt is unused) until admin/agent unpair.
   */
  async resolveByToken(token: string): Promise<SigningDevice> {
    const parts = parseTenantPrefixedToken(token, 3);
    if (!parts) throw new UnauthorizedException();
    const [tenantId, deviceId] = parts;
    const tokenHash = hashSecretToken(token);

    const device = await this.tenantPrisma.withTenant(tenantId!, (tx) =>
      tx.signingDevice.findFirst({ where: { id: deviceId, tenantId } }),
    );
    if (!device || device.status !== 'PAIRED' || device.tokenHash !== tokenHash) {
      throw new UnauthorizedException();
    }
    return device;
  }
}
