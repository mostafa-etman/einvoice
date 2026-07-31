import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import {
  assertReceivedDirection,
  receivedDirectionQuery,
} from '@einvoice/eta-core';

export type EtaDocumentsSearchPage = {
  result: Record<string, unknown>[];
  continuationToken?: string | null;
  raw: unknown;
};

/**
 * GET /api/v1.0/documents/search — always direction=Received for Purchases.
 */
export class EtaDocumentsSearchClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async searchReceived(
    accessToken: string,
    opts?: {
      pageSize?: number;
      continuationToken?: string;
      documentType?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<EtaDocumentsSearchPage> {
    const params = receivedDirectionQuery({
      pageSize: opts?.pageSize ?? 100,
      continuationToken: opts?.continuationToken,
      documentType: opts?.documentType,
      status: opts?.status,
      fromDate: opts?.fromDate,
      toDate: opts?.toDate,
    });
    assertReceivedDirection(params);

    const qs = new URLSearchParams(params).toString();
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documents/search?${qs}`;
    const res = await etaFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      this.fetchImpl,
    );
    const text = await res.text();
    if (!res.ok) {
      const mapped = mapEtaHttpError(res.status, text);
      throw new Error(mapped.message);
    }
    let raw: unknown = {};
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      raw = { rawText: text };
    }
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
      string,
      unknown
    >;
    const result = Array.isArray(obj.result)
      ? (obj.result as Record<string, unknown>[])
      : Array.isArray(obj.Result)
        ? (obj.Result as Record<string, unknown>[])
        : [];
    const continuationToken =
      (typeof obj.continuationToken === 'string'
        ? obj.continuationToken
        : typeof obj.ContinuationToken === 'string'
          ? obj.ContinuationToken
          : null) ?? null;
    return { result, continuationToken, raw };
  }
}
