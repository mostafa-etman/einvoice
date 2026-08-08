import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

/**
 * GET /api/v1.0/documents/{uuid}/details — full received document payload.
 */
export class EtaDocumentDetailsClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async getDetails(
    accessToken: string,
    documentUuid: string,
  ): Promise<Record<string, unknown>> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documents/${encodeURIComponent(documentUuid)}/details`;
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
      const err = new Error(mapped.message) as Error & {
        status?: number;
        etaCode?: string;
      };
      err.status = mapped.httpStatus;
      err.etaCode = mapped.code;
      throw err;
    }
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { rawText: text };
    }
  }
}
