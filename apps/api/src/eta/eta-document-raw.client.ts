import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

export type EtaDocumentRawResult = {
  /** Parsed JSON when Content-Type is JSON; otherwise null. */
  json: Record<string, unknown> | null;
  /** Raw response body text (JSON or XML). */
  bodyText: string;
  contentType: string;
};

/**
 * GET /api/v1.0/documents/{uuid}/raw — original submission + tax-authority
 * metadata (DocumentExtended). Prefer Accept: application/json.
 */
export class EtaDocumentRawClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async getRaw(
    accessToken: string,
    documentUuid: string,
    opts?: { accept?: 'application/json' | 'application/xml' },
  ): Promise<EtaDocumentRawResult> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documents/${encodeURIComponent(documentUuid)}/raw`;
    const accept = opts?.accept ?? 'application/json';
    const res = await etaFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: accept,
        },
      },
      this.fetchImpl,
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(mapEtaHttpError(res.status, text).message);
    }
    const contentType = res.headers.get('content-type') ?? accept;
    let json: Record<string, unknown> | null = null;
    if (contentType.includes('json') || text.trimStart().startsWith('{')) {
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = null;
      }
    }
    return { json, bodyText: text, contentType };
  }
}
