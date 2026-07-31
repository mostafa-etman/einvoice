import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

/**
 * GET /api/v1.0/documents/{uuid}/pdf — official printout.
 */
export class EtaPrintoutClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async getPdf(accessToken: string, documentUuid: string): Promise<Buffer> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documents/${encodeURIComponent(documentUuid)}/pdf`;
    const res = await etaFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/pdf',
        },
      },
      this.fetchImpl,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(mapEtaHttpError(res.status, text).message);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
}
