import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EtaEnvironment, TenantEtaCredential } from '@prisma/client';
import {
  ETA_ISSUER_TYPES,
  isIssuerNameComplete,
} from '@einvoice/eta-core';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecretsEncryptionService } from '../../crypto/secrets-encryption.service';
import { PrismaService } from '../../prisma/prisma.service';

const MASK = '••••••••';

/** Prisma Bytes fields under Node 24 Buffer typings. */
function asBytes(value: Buffer | Uint8Array): Buffer {
  return Buffer.from(value);
}

function parseEnvironment(
  value?: string | null,
): EtaEnvironment {
  if (!value || value === 'SANDBOX') return 'SANDBOX';
  if (value === 'PRODUCTION') return 'PRODUCTION';
  throw new BadRequestException({
    code: 'INVALID_ETA_ENVIRONMENT',
    message: 'environment must be SANDBOX or PRODUCTION',
  });
}

export type EtaCredentialsView = {
  id: string;
  branchId: string | null;
  environment: EtaEnvironment;
  clientId: string;
  hasClientSecret: boolean;
  clientSecretMasked: string;
  registrationNumber: string | null;
  activityCode: string | null;
  isIntermediary: boolean;
  onBehalfOfRegistrationNumber: string | null;
  onBehalfOfName: string | null;
  /** Taxpayer legal name → ETA issuer.name (tenant-level, not branch). */
  taxpayerLegalName: string | null;
  /** ETA issuer.type: B | P | F */
  issuerType: string;
  /** False when legal name is blank (required before issuing). */
  issuerIdentityComplete: boolean;
  lastValidatedAt: string | null;
  /** Tenant's currently active ETA host profile. */
  activeEnvironment: EtaEnvironment;
};

@Injectable()
export class EtaCredentialsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async get(
    tenantId: string,
    opts?: { branchId?: string; environment?: string },
  ): Promise<EtaCredentialsView | null> {
    await this.crypto.ensureReady();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return null;

    const environment = parseEnvironment(
      opts?.environment ?? tenant.activeEtaEnvironment,
    );
    const row = await this.resolveRow(tenantId, environment, opts?.branchId);

    if (!row) {
      return {
        id: '',
        branchId: null,
        environment,
        clientId: '',
        hasClientSecret: false,
        clientSecretMasked: MASK,
        registrationNumber: null,
        activityCode: null,
        isIntermediary: false,
        onBehalfOfRegistrationNumber: null,
        onBehalfOfName: null,
        taxpayerLegalName: tenant.legalName,
        issuerType: tenant.issuerType || 'B',
        issuerIdentityComplete: isIssuerNameComplete(tenant.legalName),
        lastValidatedAt: null,
        activeEnvironment: tenant.activeEtaEnvironment,
      };
    }
    return this.toView(
      row,
      tenant.legalName ?? null,
      tenant.issuerType ?? 'B',
      tenant.activeEtaEnvironment,
    );
  }

  async upsert(
    tenantId: string,
    actorUserId: string,
    input: {
      branchId?: string | null;
      environment?: string;
      clientId: string;
      clientSecret?: string;
      registrationNumber?: string;
      activityCode?: string;
      isIntermediary?: boolean;
      onBehalfOfRegistrationNumber?: string;
      onBehalfOfName?: string;
      taxpayerLegalName?: string;
      issuerType?: string;
    },
  ): Promise<EtaCredentialsView> {
    await this.crypto.ensureReady();
    const branchId = input.branchId ?? null;
    this.assertIntermediary(input);

    const tenantRow = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenantRow) throw new NotFoundException('Tenant not found');

    const environment = parseEnvironment(
      input.environment ?? tenantRow.activeEtaEnvironment,
    );

    const legalName =
      input.taxpayerLegalName !== undefined
        ? input.taxpayerLegalName.trim() || null
        : (tenantRow.legalName ?? null);
    const issuerType = this.normalizeIssuerType(
      input.issuerType !== undefined
        ? input.issuerType
        : (tenantRow.issuerType ?? 'B'),
    );
    if (!isIssuerNameComplete(legalName)) {
      throw new BadRequestException({
        code: 'ISSUER_NAME_INCOMPLETE',
        message:
          'Taxpayer legal name is required. It appears as issuer.name on every ETA invoice — do not use the branch name.',
      });
    }
    if (
      input.registrationNumber !== undefined &&
      !input.registrationNumber.trim()
    ) {
      throw new BadRequestException({
        code: 'ISSUER_ID_INCOMPLETE',
        message: 'ETA registration number (issuer.id) is required.',
      });
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { legalName, issuerType },
    });

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantEtaCredential.findFirst({
        where: branchId
          ? { tenantId, environment, branchId }
          : { tenantId, environment, branchId: null },
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
        // Secret change invalidates prior validation for that environment.
        lastValidatedAt: secretProvided ? null : existing?.lastValidatedAt,
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
          environment,
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
        environment: row.environment,
        clientId: row.clientId,
        secretSet: Boolean(input.clientSecret),
        isIntermediary: row.isIntermediary,
      },
    });

    return this.toView(
      row,
      legalName,
      issuerType,
      tenantRow.activeEtaEnvironment,
    );
  }

  async rotateSecret(
    tenantId: string,
    actorUserId: string,
    clientSecret: string,
    opts?: { branchId?: string | null; environment?: string },
  ): Promise<EtaCredentialsView> {
    await this.crypto.ensureReady();
    if (!clientSecret) {
      throw new BadRequestException('clientSecret is required');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const environment = parseEnvironment(
      opts?.environment ?? tenant.activeEtaEnvironment,
    );
    const branchId = opts?.branchId;
    const enc = this.crypto.encrypt(clientSecret);

    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.tenantEtaCredential.findFirst({
        where: branchId
          ? { tenantId, environment, branchId }
          : { tenantId, environment, branchId: null },
      });
      if (!existing) {
        throw new NotFoundException('ETA credentials not found');
      }
      return tx.tenantEtaCredential.update({
        where: { id: existing.id },
        data: {
          clientSecretCiphertext: asBytes(enc.ciphertext),
          clientSecretNonce: asBytes(enc.nonce),
          lastValidatedAt: null,
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
      metadata: {
        branchId: row.branchId,
        environment: row.environment,
        rotated: true,
      },
    });

    return this.toView(
      row,
      tenant.legalName ?? null,
      tenant.issuerType ?? 'B',
      tenant.activeEtaEnvironment,
    );
  }

  private async resolveRow(
    tenantId: string,
    environment: EtaEnvironment,
    branchId?: string,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      if (branchId) {
        const override = await tx.tenantEtaCredential.findFirst({
          where: { tenantId, environment, branchId },
        });
        if (override) return override;
      }
      return tx.tenantEtaCredential.findFirst({
        where: { tenantId, environment, branchId: null },
      });
    });
  }

  private toView(
    row: TenantEtaCredential,
    legalName: string | null,
    issuerType: string,
    activeEnvironment: EtaEnvironment,
  ): EtaCredentialsView {
    return {
      id: row.id,
      branchId: row.branchId,
      environment: row.environment,
      clientId: row.clientId,
      hasClientSecret: row.clientSecretCiphertext.length > 0,
      clientSecretMasked: MASK,
      registrationNumber: row.registrationNumber,
      activityCode: row.activityCode,
      isIntermediary: row.isIntermediary,
      onBehalfOfRegistrationNumber: row.onBehalfOfRegistrationNumber,
      onBehalfOfName: row.onBehalfOfName,
      taxpayerLegalName: legalName,
      issuerType: issuerType || 'B',
      issuerIdentityComplete: isIssuerNameComplete(legalName),
      lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
      activeEnvironment,
    };
  }

  private normalizeIssuerType(value?: string): string {
    const t = (value ?? 'B').trim().toUpperCase();
    if (!(ETA_ISSUER_TYPES as readonly string[]).includes(t)) {
      throw new BadRequestException(
        `issuerType must be one of ${ETA_ISSUER_TYPES.join(', ')}`,
      );
    }
    return t;
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
