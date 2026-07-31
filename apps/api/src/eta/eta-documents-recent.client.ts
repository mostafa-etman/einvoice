import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import {
  assertReceivedDirection,
  receivedDirectionQuery,
} from '@einvoice/eta-core';

export type EtaDocumentsRecentPage = {
  result: Record<string, unknown>[];
  raw: unknown;
};

/**
 * GET /api/v1.0/documents/recent — always direction=Received for Purchases.
 */
export class EtaDocumentsRecentClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async recentReceived(
    accessToken: string,
    opts?: { pageNo?: number; pageSize?: number },
  ): Promise<EtaDocumentsRecentPage> {
    const params = receivedDirectionQuery({
      pageNo: opts?.pageNo ?? 1,
      pageSize: opts?.pageSize ?? 100,
    });
    assertReceivedDirection(params);
    const qs = new URLSearchParams(params).toString();
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documents/recent?${qs}`;
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
      throw new Error(mapEtaHttpError(res.status, text).message);
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
    return { result, raw };
  }
}
