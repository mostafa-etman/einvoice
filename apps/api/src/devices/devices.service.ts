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

  async unpair(tenantId: string, actorUserId: string, id: string) {
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
      actorUserId,
      tenantId,
      resourceType: 'signing_device',
      resourceId: id,
      metadata: {},
    });
  }

  /**
   * Consumes a pairing code and registers a new device. Runs entirely inside
   * one tenant-scoped transaction (tenantId is parsed from the code prefix)
   * so code validation, device creation, and code consumption stay atomic.
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

      const deviceId = randomUUID();
      const { token, hash } = buildDeviceToken(tenantId!, deviceId);

      const device = await tx.signingDevice.create({
        data: {
          id: deviceId,
          tenantId: tenantId!,
          label: input.label,
          machineFingerprint: input.machineFingerprint,
          status: 'PAIRED',
          tokenHash: hash,
          pairedAt: new Date(),
        },
      });

      await tx.pairingCode.update({
        where: { id: code.id },
        data: { status: 'CONSUMED', consumedAt: new Date(), consumedByDeviceId: device.id },
      });

      return { device, token };
    });

    await this.audit.write({
      action: 'devices.pairing.consume',
      outcome: 'success',
      tenantId,
      resourceType: 'signing_device',
      resourceId: result.device.id,
      metadata: { label: result.device.label },
    });

    return {
      deviceId: result.device.id,
      deviceToken: result.token,
      tenantId,
      expiresAt: null,
    };
  }

  async heartbeat(device: SigningDevice, ready?: Record<string, unknown>) {
    await this.tenantPrisma.withTenant(device.tenantId, (tx) =>
      tx.signingDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          ...(ready ? { lastReadyJson: ready as Prisma.InputJsonValue } : {}),
        },
      }),
    );
    return { ok: true };
  }

  /** Resolves a device by its bearer token; throws 401 if invalid, revoked, or unknown tenant/device. */
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
