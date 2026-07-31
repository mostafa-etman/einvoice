import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

export type EtaPublishedCode = {
  code: string;
  description: string;
  isActive: boolean;
  raw: Record<string, unknown>;
};

export type EtaCodesPage = {
  items: EtaPublishedCode[];
  pageNumber: number;
  pageSize: number;
  totalPages: number | null;
  totalCount: number | null;
};

export type EtaItemCodeType = 'EGS' | 'GS1';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function pickActive(row: Record<string, unknown>): boolean {
  if (typeof row.active === 'boolean') return row.active;
  if (typeof row.Active === 'boolean') return row.Active;
  if (typeof row.OnlyActive === 'boolean') return row.OnlyActive;
  const activeTo = pickString(row, 'activeTo', 'ActiveTo');
  if (activeTo) {
    const t = Date.parse(activeTo);
    if (!Number.isNaN(t) && t < Date.now()) return false;
  }
  return true;
}

export function mapEtaPublishedCode(row: Record<string, unknown>): EtaPublishedCode | null {
  const code = pickString(
    row,
    'codeLookupValue',
    'CodeLookupValue',
    'itemCode',
    'ItemCode',
    'code',
    'Code',
  );
  if (!code) return null;
  const description =
    pickString(
      row,
      'codeNamePrimaryLang',
      'CodeNamePrimaryLang',
      'codeDescriptionPrimaryLang',
      'CodeDescriptionPrimaryLang',
      'codeName',
      'CodeName',
      'description',
      'Description',
    ) || code;
  return {
    code,
    description,
    isActive: pickActive(row),
    raw: row,
  };
}

export class EtaItemCodesClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!apiBaseUrl) {
      throw new Error('ETA_API_BASE_URL is required');
    }
  }

  private getFetch(): typeof fetch {
    return this.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async fetchPage(
    accessToken: string,
    codeType: EtaItemCodeType,
    opts: {
      pageNumber: number;
      pageSize: number;
      taxpayerRin?: string;
      onlyActive?: boolean;
    },
  ): Promise<EtaCodesPage> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const qs = new URLSearchParams();
    qs.set('Pn', String(opts.pageNumber));
    qs.set('Ps', String(opts.pageSize));
    if (opts.taxpayerRin) qs.set('TaxpayerRIN', opts.taxpayerRin);
    if (opts.onlyActive !== undefined) {
      qs.set('OnlyActive', opts.onlyActive ? 'true' : 'false');
    }
    const url = `${base}/api/v1.0/codetypes/${encodeURIComponent(codeType)}/codes?${qs}`;
    const json = await this.getJson(url, accessToken);
    return this.parsePage(json, opts.pageNumber, opts.pageSize);
  }

  /**
   * Walks all pages for a code type. Handles 429 Retry-After in getJson.
   */
  async *paginateAll(
    accessToken: string,
    codeType: EtaItemCodeType,
    opts?: {
      pageSize?: number;
      taxpayerRin?: string;
      onlyActive?: boolean;
      maxPages?: number;
    },
  ): AsyncGenerator<EtaCodesPage> {
    const pageSize = opts?.pageSize ?? 100;
    const maxPages = opts?.maxPages ?? 10_000;
    let pageNumber = 1;
    let totalPages: number | null = null;

    while (pageNumber <= maxPages) {
      if (totalPages != null && pageNumber > totalPages) break;
      const page = await this.fetchPage(accessToken, codeType, {
        pageNumber,
        pageSize,
        taxpayerRin: opts?.taxpayerRin,
        onlyActive: opts?.onlyActive,
      });
      yield page;
      if (page.totalPages != null) totalPages = page.totalPages;
      if (page.items.length === 0) break;
      if (totalPages == null && page.items.length < pageSize) break;
      pageNumber += 1;
    }
  }

  private parsePage(
    json: unknown,
    pageNumber: number,
    pageSize: number,
  ): EtaCodesPage {
    let rows: Record<string, unknown>[] = [];
    let totalPages: number | null = null;
    let totalCount: number | null = null;

    if (Array.isArray(json)) {
      rows = json as Record<string, unknown>[];
    } else if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      const result = obj.result ?? obj.Result ?? obj.items ?? obj.Items;
      if (Array.isArray(result)) {
        rows = result as Record<string, unknown>[];
      }
      const meta =
        (obj.metadata as Record<string, unknown> | undefined) ??
        (obj.Metadata as Record<string, unknown> | undefined) ??
        obj;
      const tp = meta.totalPages ?? meta.TotalPages;
      const tc = meta.totalCount ?? meta.TotalCount;
      if (typeof tp === 'number') totalPages = tp;
      if (typeof tc === 'number') totalCount = tc;
    }

    const items = rows
      .map((r) => mapEtaPublishedCode(r))
      .filter((x): x is EtaPublishedCode => x != null);

    return { items, pageNumber, pageSize, totalPages, totalCount };
  }

  private async getJson(url: string, accessToken: string): Promise<unknown> {
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      if (res.status === 429 && attempt < maxAttempts - 1) {
        const retryAfter = res.headers.get('Retry-After');
        const sec = retryAfter ? Number(retryAfter) : NaN;
        const waitMs = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 2000 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }
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
      return text ? JSON.parse(text) : [];
    }
    throw new Error('ETA item-codes request failed after rate-limit retries');
  }
}
