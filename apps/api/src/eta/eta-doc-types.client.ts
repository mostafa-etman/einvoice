import Redis from 'ioredis';
import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

export type DocTypesCachePayload = {
  items: Record<string, unknown>[];
  fetchedAt: number;
};

export class EtaDocTypesClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly redis: Redis,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!apiBaseUrl) {
      throw new Error('ETA_API_BASE_URL is required');
    }
  }

  private getFetch(): typeof fetch {
    return this.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private typesKey(tenantId: string, environment = 'SANDBOX') {
    return `eta:doctypes:${tenantId}:${environment}`;
  }

  private versionsKey(tenantId: string, typeId: string, environment = 'SANDBOX') {
    return `eta:doctype-ver:${tenantId}:${environment}:${typeId}`;
  }

  async listDocumentTypes(
    tenantId: string,
    accessToken: string,
    opts?: { refresh?: boolean; environment?: string },
  ): Promise<{ items: Record<string, unknown>[]; fetchedAt: string; fromCache: boolean }> {
    const environment = opts?.environment ?? 'SANDBOX';
    const key = this.typesKey(tenantId, environment);
    if (!opts?.refresh) {
      const cached = await this.readCache(key);
      if (cached) {
        return {
          items: cached.items,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          fromCache: true,
        };
      }
    }
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/api/v1.0/documenttypes`;
    const items = await this.getJsonArray(url, accessToken);
    const fetchedAt = Date.now();
    await this.redis.set(
      key,
      JSON.stringify({ items, fetchedAt } satisfies DocTypesCachePayload),
      'EX',
      3600,
    );
    return {
      items,
      fetchedAt: new Date(fetchedAt).toISOString(),
      fromCache: false,
    };
  }

  async getDocumentTypeVersions(
    tenantId: string,
    typeId: string,
    accessToken: string,
    opts?: { refresh?: boolean; environment?: string },
  ): Promise<{
    documentTypeId: string;
    items: Record<string, unknown>[];
    fetchedAt: string;
    fromCache: boolean;
  }> {
    const environment = opts?.environment ?? 'SANDBOX';
    const key = this.versionsKey(tenantId, typeId, environment);
    if (!opts?.refresh) {
      const cached = await this.readCache(key);
      if (cached) {
        return {
          documentTypeId: typeId,
          items: cached.items,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          fromCache: true,
        };
      }
    }
    const url = `${this.apiBaseUrl.replace(/\/$/, '')}/api/v1.0/documenttypes/${encodeURIComponent(typeId)}/versions`;
    const items = await this.getJsonArray(url, accessToken);
    const fetchedAt = Date.now();
    await this.redis.set(
      key,
      JSON.stringify({ items, fetchedAt } satisfies DocTypesCachePayload),
      'EX',
      3600,
    );
    return {
      documentTypeId: typeId,
      items,
      fetchedAt: new Date(fetchedAt).toISOString(),
      fromCache: false,
    };
  }

  private async readCache(key: string): Promise<DocTypesCachePayload | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DocTypesCachePayload;
    } catch {
      return null;
    }
  }

  private async getJsonArray(
    url: string,
    accessToken: string,
  ): Promise<Record<string, unknown>[]> {
    const res = await etaFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      this.getFetch(),
    );
    const text = await res.text();
    if (!res.ok) {
      const mapped = mapEtaHttpError(res.status, text);
      const err = new Error(mapped.message) as Error & {
        etaCode?: string;
        status?: number;
      };
      err.etaCode = mapped.code;
      err.status = mapped.httpStatus;
      throw err;
    }
    const json = text ? (JSON.parse(text) as unknown) : [];
    if (Array.isArray(json)) return json as Record<string, unknown>[];
    if (
      json &&
      typeof json === 'object' &&
      Array.isArray((json as { result?: unknown }).result)
    ) {
      return (json as { result: Record<string, unknown>[] }).result;
    }
    return [];
  }
}
