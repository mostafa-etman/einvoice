import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import type { EtaEnvironment } from '@prisma/client';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
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
import {
  etaEnvironmentLabel,
  resolveEtaHostUrls,
  type EtaHostUrls,
} from './eta-environment';

@Injectable()
export class EtaService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly tokens: EtaTokenCache;
  private readonly envConfig = loadEnv();
  private lastTest = new Map<
    string,
    { outcome: 'success' | 'failure'; message: string; environment: EtaEnvironment }
  >();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsEncryptionService,
    private readonly audit: AuditService,
  ) {
    this.redis = new Redis(this.envConfig.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.tokens = new EtaTokenCache(this.redis);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  async getActiveEnvironment(tenantId: string): Promise<EtaEnvironment> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { activeEtaEnvironment: true },
    });
    return tenant?.activeEtaEnvironment ?? 'SANDBOX';
  }

  async resolveHosts(
    tenantId: string,
    environment?: EtaEnvironment,
  ): Promise<EtaHostUrls> {
    const env = environment ?? (await this.getActiveEnvironment(tenantId));
    return resolveEtaHostUrls(env, this.envConfig);
  }

  async getApiBaseUrl(
    tenantId: string,
    environment?: EtaEnvironment,
  ): Promise<string> {
    return (await this.resolveHosts(tenantId, environment)).apiBaseUrl;
  }

  async getConnectionStatus(
    tenantId: string,
    opts?: { branchId?: string; environment?: EtaEnvironment },
  ): Promise<EtaConnectionStatus> {
    const hosts = await this.resolveHosts(tenantId, opts?.environment);
    const creds = await this.loadCredentialMaterial(
      tenantId,
      hosts.environment,
      opts?.branchId,
    );
    if (!creds.ok) {
      return {
        connected: false,
        setupRequired: true,
        expiresAt: null,
        scope: null,
        environment: hosts.label,
        activeEnvironment: hosts.environment,
        lastTestOutcome: 'never',
        lastTestMessage: creds.message,
        settingsPath: ETA_SETTINGS_PATH,
      };
    }
    const cached = await this.tokens.get({
      tenantId,
      clientId: creds.clientId,
      onBehalfOf: creds.onBehalfOf,
      environment: hosts.environment,
    });
    const last = this.lastTest.get(`${tenantId}:${hosts.environment}`);
    const connected = Boolean(cached && cached.accessToken);
    return {
      connected,
      setupRequired: false,
      expiresAt: cached
        ? new Date(cached.obtainedAt + cached.expiresIn * 1000).toISOString()
        : null,
      scope: cached?.scope ?? null,
      environment: hosts.label,
      activeEnvironment: hosts.environment,
      lastTestOutcome: last?.outcome ?? (connected ? 'success' : 'never'),
      lastTestMessage: last?.message ?? null,
      settingsPath: ETA_SETTINGS_PATH,
    };
  }

  /**
   * Obtain a cached access token for the tenant's active (or override) ETA host.
   */
  async getAccessToken(
    tenantId: string,
    opts?: {
      branchId?: string;
      forceRefresh?: boolean;
      environment?: EtaEnvironment;
    },
  ): Promise<string> {
    const hosts = await this.resolveHosts(tenantId, opts?.environment);
    const creds = await this.loadCredentialMaterial(
      tenantId,
      hosts.environment,
      opts?.branchId,
    );
    if (!creds.ok) {
      throw new BadRequestException({
        code: ETA_SETUP_CODE,
        message: creds.message,
        settingsPath: ETA_SETTINGS_PATH,
      });
    }

    const identity = {
      tenantId,
      clientId: creds.clientId,
      onBehalfOf: creds.onBehalfOf,
      environment: hosts.environment,
    };

    if (opts?.forceRefresh) {
      await this.tokens.invalidate(identity);
    }

    const auth = new EtaAuthClient(hosts.identityBaseUrl);
    const entry = await this.tokens.getOrRefresh(identity, async () => {
      const token = await auth.requestToken({
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
        clientId: creds.clientId,
      } satisfies CachedToken;
    });
    return entry.accessToken;
  }

  async withAccessToken<T>(
    tenantId: string,
    opts: { branchId?: string; environment?: EtaEnvironment } | undefined,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.getAccessToken(tenantId, opts);
    try {
      return await fn(token);
    } catch (err) {
      if (!isEtaUnauthorized(err)) throw err;
      const fresh = await this.getAccessToken(tenantId, {
        ...opts,
        forceRefresh: true,
      });
      return await fn(fresh);
    }
  }

  async testConnection(
    tenantId: string,
    actorUserId: string | undefined,
    opts?: { branchId?: string; environment?: EtaEnvironment },
  ): Promise<EtaConnectionStatus> {
    const hosts = await this.resolveHosts(tenantId, opts?.environment);
    try {
      const accessToken = await this.getAccessToken(tenantId, {
        branchId: opts?.branchId,
        environment: hosts.environment,
        forceRefresh: true,
      });
      if (!accessToken) {
        throw new Error('No access_token acquired');
      }

      await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const row = await tx.tenantEtaCredential.findFirst({
          where: {
            tenantId,
            environment: hosts.environment,
            branchId: opts?.branchId ?? null,
          },
        });
        if (row) {
          await tx.tenantEtaCredential.update({
            where: { id: row.id },
            data: { lastValidatedAt: new Date() },
          });
        } else if (!opts?.branchId) {
          const tenantWide = await tx.tenantEtaCredential.findFirst({
            where: {
              tenantId,
              environment: hosts.environment,
              branchId: null,
            },
          });
          if (tenantWide) {
            await tx.tenantEtaCredential.update({
              where: { id: tenantWide.id },
              data: { lastValidatedAt: new Date() },
            });
          }
        }
      });

      const status = await this.getConnectionStatus(tenantId, {
        branchId: opts?.branchId,
        environment: hosts.environment,
      });
      this.lastTest.set(`${tenantId}:${hosts.environment}`, {
        outcome: 'success',
        message: 'Token acquired from ETA identity',
        environment: hosts.environment,
      });
      await this.audit.write({
        action: 'eta.test_connection.success',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'eta_connection',
        metadata: {
          environment: hosts.label,
          etaEnvironment: hosts.environment,
        },
      });
      return {
        ...status,
        connected: true,
        lastTestOutcome: 'success',
        lastTestMessage: 'Token acquired from ETA identity',
        accessToken,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Test Connection failed';
      const code =
        err instanceof BadRequestException
          ? ((err.getResponse() as { code?: string })?.code ?? 'bad_request')
          : (err as { etaCode?: string })?.etaCode;

      this.lastTest.set(`${tenantId}:${hosts.environment}`, {
        outcome: 'failure',
        message,
        environment: hosts.environment,
      });
      await this.audit.write({
        action: 'eta.test_connection.failure',
        outcome: 'failure',
        actorUserId,
        tenantId,
        resourceType: 'eta_connection',
        metadata: {
          code: code ?? 'error',
          environment: hosts.label,
          etaEnvironment: hosts.environment,
        },
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
    const hosts = await this.resolveHosts(tenantId);
    const token = await this.getAccessToken(tenantId, {
      branchId: opts?.branchId,
    });
    const docTypes = new EtaDocTypesClient(hosts.apiBaseUrl, this.redis);
    const result = await docTypes.listDocumentTypes(tenantId, token, {
      refresh: opts?.refresh,
      environment: hosts.environment,
    });
    if (opts?.refresh) {
      await this.audit.write({
        action: 'eta.document_types.refresh.success',
        outcome: 'success',
        tenantId,
        resourceType: 'eta_document_types',
        metadata: { etaEnvironment: hosts.environment },
      });
    }
    return result;
  }

  async getDocumentTypeVersions(
    tenantId: string,
    typeId: string,
    opts?: { refresh?: boolean; branchId?: string },
  ) {
    const hosts = await this.resolveHosts(tenantId);
    const token = await this.getAccessToken(tenantId, {
      branchId: opts?.branchId,
    });
    const docTypes = new EtaDocTypesClient(hosts.apiBaseUrl, this.redis);
    return docTypes.getDocumentTypeVersions(tenantId, typeId, token, {
      refresh: opts?.refresh,
      environment: hosts.environment,
    });
  }

  /** Drop cached tokens for a tenant environment (e.g. after switch or secret rotate). */
  async invalidateTokensForEnvironment(
    tenantId: string,
    environment: EtaEnvironment,
    clientId?: string,
    onBehalfOf?: string | null,
  ): Promise<void> {
    if (clientId) {
      await this.tokens.invalidate({
        tenantId,
        clientId,
        onBehalfOf: onBehalfOf ?? null,
        environment,
      });
      return;
    }
    // Best-effort: wipe known pattern via Redis SCAN is overkill; callers
    // pass clientId when available. Switching env uses a different cache key.
    void etaEnvironmentLabel(environment);
  }

  private async loadCredentialMaterial(
    tenantId: string,
    environment: EtaEnvironment,
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
          where: { tenantId, environment, branchId },
        });
        if (override) return override;
      }
      return tx.tenantEtaCredential.findFirst({
        where: { tenantId, environment, branchId: null },
      });
    });

    if (!row?.clientId || !row.clientSecretCiphertext?.length) {
      return {
        ok: false,
        message: `ETA Client ID and Client Secret are not configured for ${etaEnvironmentLabel(environment)}. Open Settings → ETA credentials.`,
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

/** True when an ETA API call failed because the bearer token was rejected. */
export function isEtaUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status =
    (err as { httpStatus?: number }).httpStatus ??
    (err as { status?: number }).status;
  if (status === 401) return true;
  const code =
    (err as { code?: string; etaCode?: string }).code ??
    (err as { etaCode?: string }).etaCode;
  return code === 'unauthorized' || code === 'invalid_token';
}
