import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SecretsEncryptionService } from '../crypto/secrets-encryption.service';
import { AuditService } from '../audit/audit.service';
import { EtaAuthClient } from './eta-auth.client';
import { EtaTokenCache, type CachedToken } from './eta-token.cache';
import { EtaDocTypesClient } from './eta-doc-types.client';
import {
  ETA_SETTINGS_PATH,
  ETA_SETUP_CODE,
  type EtaConnectionStatus,
} from './eta-service.types';

@Injectable()
export class EtaService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly auth: EtaAuthClient;
  private readonly tokens: EtaTokenCache;
  private readonly docTypes: EtaDocTypesClient;
  private readonly identityBaseUrl: string;
  private readonly apiBaseUrl: string;
  private lastTest = new Map<
    string,
    { outcome: 'success' | 'failure'; message: string }
  >();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly crypto: SecretsEncryptionService,
    private readonly audit: AuditService,
  ) {
    const env = loadEnv();
    this.identityBaseUrl = env.ETA_IDENTITY_BASE_URL;
    this.apiBaseUrl = env.ETA_API_BASE_URL;
    this.redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.auth = new EtaAuthClient(this.identityBaseUrl);
    this.tokens = new EtaTokenCache(this.redis);
    this.docTypes = new EtaDocTypesClient(this.apiBaseUrl, this.redis);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  private environmentLabel(): string {
    const host = this.identityBaseUrl.toLowerCase();
    if (host.includes('preprod') || host.includes('sandbox')) return 'sandbox';
    if (host.includes('eta.gov')) return 'production';
    return 'custom';
  }

  async getConnectionStatus(
    tenantId: string,
    branchId?: string,
  ): Promise<EtaConnectionStatus> {
    const creds = await this.loadCredentialMaterial(tenantId, branchId);
    if (!creds.ok) {
      return {
        connected: false,
        setupRequired: true,
        expiresAt: null,
        scope: null,
        environment: this.environmentLabel(),
        lastTestOutcome: 'never',
        lastTestMessage: creds.message,
        settingsPath: ETA_SETTINGS_PATH,
      };
    }
    const cached = await this.tokens.get(tenantId, creds.onBehalfOf);
    const last = this.lastTest.get(tenantId);
    const connected = Boolean(cached && cached.accessToken);
    return {
      connected,
      setupRequired: false,
      expiresAt: cached
        ? new Date(cached.obtainedAt + cached.expiresIn * 1000).toISOString()
        : null,
      scope: cached?.scope ?? null,
      environment: this.environmentLabel(),
      lastTestOutcome: last?.outcome ?? (connected ? 'success' : 'never'),
      lastTestMessage: last?.message ?? null,
      settingsPath: ETA_SETTINGS_PATH,
    };
  }

  /**
   * Obtain/cached access token. Returns real access_token string for callers/tests.
   * Does not use ETA_CLIENT_ID / ETA_CLIENT_SECRET env globals.
   */
  async getAccessToken(
    tenantId: string,
    opts?: { branchId?: string; forceRefresh?: boolean },
  ): Promise<string> {
    const creds = await this.loadCredentialMaterial(tenantId, opts?.branchId);
    if (!creds.ok) {
      throw new BadRequestException({
        code: ETA_SETUP_CODE,
        message: creds.message,
        settingsPath: ETA_SETTINGS_PATH,
      });
    }

    if (opts?.forceRefresh) {
      await this.tokens.invalidate(tenantId, creds.onBehalfOf);
    }

    const entry = await this.tokens.getOrRefresh(
      tenantId,
      creds.onBehalfOf,
      async () => {
        const token = await this.auth.requestToken({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          onBehalfOf: creds.onBehalfOf,
        });
        return {
          accessToken: token.access_token,
          expiresIn: token.expires_in,
          obtainedAt: Date.now(),
          scope: token.scope,
          tokenType: token.token_type,
          onBehalfOf: creds.onBehalfOf,
        } satisfies CachedToken;
      },
    );
    return entry.accessToken;
  }

  async testConnection(
    tenantId: string,
    actorUserId: string | undefined,
    branchId?: string,
  ): Promise<EtaConnectionStatus> {
    try {
      const accessToken = await this.getAccessToken(tenantId, {
        branchId,
        forceRefresh: true,
      });
      if (!accessToken) {
        throw new Error('No access_token acquired');
      }
      const status = await this.getConnectionStatus(tenantId, branchId);
      this.lastTest.set(tenantId, {
        outcome: 'success',
        message: 'Token acquired from ETA identity',
      });
      await this.audit.write({
        action: 'eta.test_connection.success',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'eta_connection',
        metadata: { environment: this.environmentLabel() },
      });
      return {
        ...status,
        connected: true,
        lastTestOutcome: 'success',
        lastTestMessage: 'Token acquired from ETA identity',
        accessToken,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test Connection failed';
      const code =
        err instanceof BadRequestException
          ? ((err.getResponse() as { code?: string })?.code ?? 'bad_request')
          : (err as { etaCode?: string })?.etaCode;

      this.lastTest.set(tenantId, { outcome: 'failure', message });
      await this.audit.write({
        action: 'eta.test_connection.failure',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'eta_connection',
        metadata: { code: code ?? 'error' },
      });

      if (err instanceof BadRequestException) throw err;
      const status = (err as { status?: number })?.status;
      if (status === 401 || code === 'invalid_client') {
        throw new UnauthorizedException({
          code: code ?? 'invalid_client',
          message,
        });
      }
      throw err;
    }
  }

  async listDocumentTypes(
    tenantId: string,
    opts?: { refresh?: boolean; branchId?: string },
  ) {
    const token = await this.getAccessToken(tenantId, { branchId: opts?.branchId });
    const result = await this.docTypes.listDocumentTypes(tenantId, token, {
      refresh: opts?.refresh,
    });
    if (opts?.refresh) {
      await this.audit.write({
        action: 'eta.document_types.refresh.success',
        outcome: 'success',
        tenantId,
        resourceType: 'eta_document_types',
      });
    }
    return result;
  }

  async getDocumentTypeVersions(
    tenantId: string,
    typeId: string,
    opts?: { refresh?: boolean; branchId?: string },
  ) {
    const token = await this.getAccessToken(tenantId, { branchId: opts?.branchId });
    return this.docTypes.getDocumentTypeVersions(tenantId, typeId, token, {
      refresh: opts?.refresh,
    });
  }

  private async loadCredentialMaterial(
    tenantId: string,
    branchId?: string,
  ): Promise<
    | {
        ok: true;
        clientId: string;
        clientSecret: string;
        onBehalfOf: string | null;
      }
    | { ok: false; message: string }
  > {
    await this.crypto.ensureReady();
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
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

    if (!row?.clientId || !row.clientSecretCiphertext?.length) {
      return {
        ok: false,
        message:
          'ETA Client ID and Client Secret are not configured. Open Settings → ETA credentials.',
      };
    }
    if (row.isIntermediary && !row.onBehalfOfRegistrationNumber) {
      return {
        ok: false,
        message:
          'Intermediary mode requires on-behalf-of registration number in ETA credentials settings.',
      };
    }

    const clientSecret = this.crypto.decrypt(
      row.clientSecretCiphertext,
      row.clientSecretNonce,
    );
    return {
      ok: true,
      clientId: row.clientId,
      clientSecret,
      onBehalfOf: row.isIntermediary
        ? row.onBehalfOfRegistrationNumber
        : null,
    };
  }
}
