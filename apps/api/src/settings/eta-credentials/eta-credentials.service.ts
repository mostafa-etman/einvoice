import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TenantEtaCredential } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecretsEncryptionService } from '../../crypto/secrets-encryption.service';

const MASK = '••••••••';

/** Prisma Bytes fields under Node 24 Buffer typings. */
function asBytes(value: Buffer | Uint8Array): Buffer {
  return Buffer.from(value);
}

export type EtaCredentialsView = {
  id: string;
  branchId: string | null;
  clientId: string;
  hasClientSecret: boolean;
  clientSecretMasked: string;
  registrationNumber: string | null;
  activityCode: string | null;
  isIntermediary: boolean;
  onBehalfOfRegistrationNumber: string | null;
  onBehalfOfName: string | null;
};

@Injectable()
export class EtaCredentialsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly crypto: SecretsEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string, branchId?: string): Promise<EtaCredentialsView | null> {
    await this.crypto.ensureReady();
    const row = await this.resolveRow(tenantId, branchId);
    return row ? this.toView(row) : null;
  }

  async upsert(
    tenantId: string,
    actorUserId: string,
    input: {
      branchId?: string | null;
      clientId: string;
      clientSecret?: string;
      registrationNumber?: string;
      activityCode?: string;
      isIntermediary?: boolean;
      onBehalfOfRegistrationNumber?: string;
      onBehalfOfName?: string;
    },
  ): Promise<EtaCredentialsView> {
    await this.crypto.ensureReady();
    const branchId = input.branchId ?? null;
    this.assertIntermediary(input);

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantEtaCredential.findFirst({
        where: branchId
          ? { tenantId, branchId }
          : { tenantId, branchId: null },
      });

      const secretProvided =
        typeof input.clientSecret === 'string' && input.clientSecret.length > 0;

      if (!existing && !secretProvided) {
        throw new BadRequestException('clientSecret is required on create');
      }

      let ciphertext: Buffer | undefined = existing?.clientSecretCiphertext
        ? Buffer.from(existing.clientSecretCiphertext)
        : undefined;
      let nonce: Buffer | undefined = existing?.clientSecretNonce
        ? Buffer.from(existing.clientSecretNonce)
        : undefined;
      if (secretProvided) {
        const enc = this.crypto.encrypt(input.clientSecret!);
        ciphertext = asBytes(enc.ciphertext);
        nonce = asBytes(enc.nonce);
      }

      if (!ciphertext || !nonce) {
        throw new BadRequestException('clientSecret is required');
      }

      const data = {
        clientId: input.clientId,
        clientSecretCiphertext: asBytes(ciphertext),
        clientSecretNonce: asBytes(nonce),
        registrationNumber: input.registrationNumber ?? null,
        activityCode: input.activityCode ?? null,
        isIntermediary: input.isIntermediary ?? false,
        onBehalfOfRegistrationNumber:
          input.onBehalfOfRegistrationNumber ?? null,
        onBehalfOfName: input.onBehalfOfName ?? null,
      };

      if (existing) {
        return tx.tenantEtaCredential.update({
          where: { id: existing.id },
          data: data as never,
        });
      }
      return tx.tenantEtaCredential.create({
        data: {
          tenantId,
          branchId,
          ...data,
        } as never,
      });
    });

    await this.audit.write({
      action: 'settings.eta_credentials.upsert',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant_eta_credential',
      resourceId: row.id,
      metadata: {
        branchId: row.branchId,
        clientId: row.clientId,
        secretSet: Boolean(input.clientSecret),
        isIntermediary: row.isIntermediary,
      },
    });

    return this.toView(row);
  }

  async rotateSecret(
    tenantId: string,
    actorUserId: string,
    clientSecret: string,
    branchId?: string | null,
  ): Promise<EtaCredentialsView> {
    await this.crypto.ensureReady();
    if (!clientSecret) {
      throw new BadRequestException('clientSecret is required');
    }
    const enc = this.crypto.encrypt(clientSecret);

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantEtaCredential.findFirst({
        where: branchId
          ? { tenantId, branchId }
          : { tenantId, branchId: null },
      });
      if (!existing) {
        throw new NotFoundException('ETA credentials not found');
      }
      return tx.tenantEtaCredential.update({
        where: { id: existing.id },
        data: {
          clientSecretCiphertext: asBytes(enc.ciphertext),
          clientSecretNonce: asBytes(enc.nonce),
        } as never,
      });
    });

    await this.audit.write({
      action: 'settings.eta_credentials.rotate',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'tenant_eta_credential',
      resourceId: row.id,
      metadata: { branchId: row.branchId, rotated: true },
    });

    return this.toView(row);
  }

  private async resolveRow(tenantId: string, branchId?: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      if (branchId) {
        const override = await tx.tenantEtaCredential.findFirst({
          where: { tenantId, branchId },
        });
        if (override) return override;
      }
      return tx.tenantEtaCredential.findFirst({
        where: { tenantId, branchId: null },
      });
    });
  }

  private toView(row: TenantEtaCredential): EtaCredentialsView {
    return {
      id: row.id,
      branchId: row.branchId,
      clientId: row.clientId,
      hasClientSecret: row.clientSecretCiphertext.length > 0,
      clientSecretMasked: MASK,
      registrationNumber: row.registrationNumber,
      activityCode: row.activityCode,
      isIntermediary: row.isIntermediary,
      onBehalfOfRegistrationNumber: row.onBehalfOfRegistrationNumber,
      onBehalfOfName: row.onBehalfOfName,
    };
  }

  private assertIntermediary(input: {
    isIntermediary?: boolean;
    onBehalfOfRegistrationNumber?: string;
  }) {
    if (input.isIntermediary && !input.onBehalfOfRegistrationNumber) {
      throw new BadRequestException(
        'onBehalfOfRegistrationNumber is required when isIntermediary is true',
      );
    }
  }
}
