import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PosDevice, PosDeviceStatus, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { QuotaService } from '../../billing/quota.service';
import { SecretsEncryptionService } from '../../crypto/secrets-encryption.service';

const MASK = '••••••••';

const POS_STATUSES: PosDeviceStatus[] = [
  'ACTIVE',
  'RETIRED',
  'PERMANENTLY_RETIRED',
];

export type PosDeviceView = {
  id: string;
  branchId: string;
  label: string;
  serialNumber: string;
  osVersion: string;
  modelFramework: string;
  hasPreSharedKey: boolean;
  preSharedKeyMasked: string;
  status: PosDeviceStatus;
  lastReceiptUuid: string;
  signingDeviceId: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PosDeviceCreateInput = {
  branchId: string;
  label?: string;
  serialNumber: string;
  osVersion: string;
  modelFramework: string;
  preSharedKey: string;
  signingDeviceId?: string | null;
  expiresAt?: string | null;
};

export type PosDeviceUpdateInput = {
  branchId?: string;
  label?: string;
  serialNumber?: string;
  osVersion?: string;
  modelFramework?: string;
  preSharedKey?: string;
  status?: PosDeviceStatus;
  signingDeviceId?: string | null;
  expiresAt?: string | null;
};

function asBytes(value: Buffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(value.byteLength);
  out.set(value);
  return out;
}

@Injectable()
export class PosDevicesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly quota: QuotaService,
    private readonly crypto: SecretsEncryptionService,
  ) {}

  async list(tenantId: string, branchId?: string): Promise<PosDeviceView[]> {
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.posDevice.findMany({
        where: { tenantId, ...(branchId ? { branchId } : {}) },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((row) => this.toView(row));
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: PosDeviceCreateInput,
  ): Promise<PosDeviceView> {
    await this.crypto.ensureReady();
    const serial = this.requireSerial(input.serialNumber);
    const osVersion = this.requireLen(input.osVersion, 'osVersion', 50);
    const modelFramework = this.requireLen(
      input.modelFramework,
      'modelFramework',
      10,
    );
    const psk = this.requirePsk(input.preSharedKey);
    const label = (input.label?.trim() || serial).slice(0, 100);

    await this.quota.checkTenantWritable(tenantId);

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await this.assertBranch(tx, tenantId, input.branchId);
      const signingDeviceId = await this.assertSigningDevice(
        tx,
        tenantId,
        input.signingDeviceId,
      );
      await this.assertQuotaForActiveSlot(tenantId, {
        status: 'ACTIVE',
        signingDeviceId,
      });
      const enc = this.crypto.encrypt(psk);
      try {
        return await tx.posDevice.create({
          data: {
            tenantId,
            branchId: input.branchId,
            label,
            serialNumber: serial,
            osVersion,
            modelFramework,
            preSharedKeyCiphertext: asBytes(enc.ciphertext),
            preSharedKeyNonce: asBytes(enc.nonce),
            status: 'ACTIVE',
            lastReceiptUuid: '',
            signingDeviceId,
            activatedAt: new Date(),
            expiresAt: this.parseDate(input.expiresAt),
          },
        });
      } catch (err) {
        this.rethrowSerialConflict(err);
        throw err;
      }
    });

    await this.audit.write({
      action: 'settings.pos_device.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'pos_device',
      resourceId: row.id,
      metadata: { branchId: row.branchId, serialNumber: row.serialNumber },
    });
    return this.toView(row);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: PosDeviceUpdateInput,
  ): Promise<PosDeviceView> {
    await this.crypto.ensureReady();
    await this.quota.checkTenantWritable(tenantId);

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.posDevice.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('POS device not found');

      if (input.status !== undefined && !isPosDeviceStatus(input.status)) {
        throw new BadRequestException('Invalid POS status');
      }

      if (
        existing.status === 'PERMANENTLY_RETIRED' &&
        input.status &&
        input.status !== 'PERMANENTLY_RETIRED'
      ) {
        throw new BadRequestException({
          code: 'POS_PERMANENTLY_RETIRED',
          message:
            'A permanently retired POS cannot be reactivated. Register a new POS on your ETA profile.',
        });
      }

      if (input.serialNumber !== undefined && existing.lastReceiptUuid) {
        throw new BadRequestException({
          code: 'POS_SERIAL_LOCKED',
          message:
            'This POS has already issued receipts. The serial number cannot change because it is part of the ETA previousUUID chain.',
        });
      }

      const nextStatus = input.status ?? existing.status;
      const nextSigning =
        input.signingDeviceId !== undefined
          ? await this.assertSigningDevice(tx, tenantId, input.signingDeviceId)
          : existing.signingDeviceId;

      const becomingActiveSlot =
        nextStatus === 'ACTIVE' && existing.status !== 'ACTIVE';
      const losingLink =
        nextStatus === 'ACTIVE' &&
        existing.status === 'ACTIVE' &&
        existing.signingDeviceId &&
        !nextSigning;
      if (becomingActiveSlot || losingLink) {
        await this.assertQuotaForActiveSlot(tenantId, {
          status: 'ACTIVE',
          signingDeviceId: nextSigning,
        });
      }

      if (input.branchId) {
        await this.assertBranch(tx, tenantId, input.branchId);
      }

      let ciphertext: Uint8Array<ArrayBuffer> = asBytes(
        existing.preSharedKeyCiphertext,
      );
      let nonce: Uint8Array<ArrayBuffer> = asBytes(existing.preSharedKeyNonce);
      if (input.preSharedKey !== undefined) {
        const enc = this.crypto.encrypt(this.requirePsk(input.preSharedKey));
        ciphertext = asBytes(enc.ciphertext);
        nonce = asBytes(enc.nonce);
      }

      const retired =
        nextStatus === 'RETIRED' || nextStatus === 'PERMANENTLY_RETIRED';

      try {
        return await tx.posDevice.update({
          where: { id },
          data: {
            ...(input.branchId ? { branchId: input.branchId } : {}),
            ...(input.label !== undefined
              ? { label: input.label.trim().slice(0, 100) || existing.label }
              : {}),
            ...(input.serialNumber !== undefined
              ? { serialNumber: this.requireSerial(input.serialNumber) }
              : {}),
            ...(input.osVersion !== undefined
              ? { osVersion: this.requireLen(input.osVersion, 'osVersion', 50) }
              : {}),
            ...(input.modelFramework !== undefined
              ? {
                  modelFramework: this.requireLen(
                    input.modelFramework,
                    'modelFramework',
                    10,
                  ),
                }
              : {}),
            preSharedKeyCiphertext: ciphertext,
            preSharedKeyNonce: nonce,
            status: nextStatus,
            signingDeviceId: nextSigning,
            ...(input.expiresAt !== undefined
              ? { expiresAt: this.parseDate(input.expiresAt) }
              : {}),
            activatedAt:
              nextStatus === 'ACTIVE' && existing.status !== 'ACTIVE'
                ? new Date()
                : existing.activatedAt,
            retiredAt: retired
              ? (existing.retiredAt ?? new Date())
              : nextStatus === 'ACTIVE'
                ? null
                : existing.retiredAt,
          },
        });
      } catch (err) {
        this.rethrowSerialConflict(err);
        throw err;
      }
    });

    await this.audit.write({
      action: 'settings.pos_device.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'pos_device',
      resourceId: row.id,
      metadata: { status: row.status, serialNumber: row.serialNumber },
    });
    return this.toView(row);
  }

  private toView(row: PosDevice): PosDeviceView {
    return {
      id: row.id,
      branchId: row.branchId,
      label: row.label,
      serialNumber: row.serialNumber,
      osVersion: row.osVersion,
      modelFramework: row.modelFramework,
      hasPreSharedKey: row.preSharedKeyCiphertext.length > 0,
      preSharedKeyMasked: MASK,
      status: row.status,
      lastReceiptUuid: row.lastReceiptUuid,
      signingDeviceId: row.signingDeviceId,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      retiredAt: row.retiredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertQuotaForActiveSlot(
    tenantId: string,
    opts: {
      status: PosDeviceStatus;
      signingDeviceId: string | null;
    },
  ) {
    if (opts.status !== 'ACTIVE') return;
    const linkedPaired = await this.quota.posSharesSigningSlot(
      tenantId,
      opts.signingDeviceId,
    );
    if (linkedPaired) return;
    await this.quota.assertWithinLimits(tenantId, 'devices');
  }

  private async assertBranch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException({
        code: 'POS_BRANCH_NOT_FOUND',
        message: 'POS devices must belong to one of your branches.',
      });
    }
  }

  private async assertSigningDevice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    signingDeviceId: string | null | undefined,
  ): Promise<string | null> {
    if (!signingDeviceId) return null;
    const device = await tx.signingDevice.findFirst({
      where: { id: signingDeviceId, tenantId },
      select: { id: true },
    });
    if (!device) {
      throw new BadRequestException({
        code: 'POS_SIGNING_DEVICE_NOT_FOUND',
        message: 'The linked signing agent must belong to this company.',
      });
    }
    return device.id;
  }

  private requireSerial(value: string): string {
    const serial = value?.trim() ?? '';
    if (!serial) {
      throw new BadRequestException('POS serial number is required');
    }
    if (serial.length > 100) {
      throw new BadRequestException('POS serial number must be at most 100 characters');
    }
    return serial;
  }

  private requireLen(value: string, field: string, max: number): string {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }
    if (trimmed.length > max) {
      throw new BadRequestException(`${field} must be at most ${max} characters`);
    }
    return trimmed;
  }

  private requirePsk(value: string): string {
    const psk = value?.trim() ?? '';
    if (!psk) {
      throw new BadRequestException('POS pre-shared key is required');
    }
    if (psk.length > 200) {
      throw new BadRequestException('POS pre-shared key must be at most 200 characters');
    }
    return psk;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (value == null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('expiresAt must be a valid date');
    }
    return d;
  }

  private rethrowSerialConflict(err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'POS_SERIAL_DUPLICATE',
        message: 'A POS device with this serial number already exists in this company.',
      });
    }
  }
}

export function isPosDeviceStatus(value: unknown): value is PosDeviceStatus {
  return typeof value === 'string' && (POS_STATUSES as string[]).includes(value);
}
