import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

/**
 * GET /api/v1.0/documentsubmissions/{uuid} — submission receipt / document
 * statuses for a previously accepted batch.
 */
export class EtaSubmissionStatusClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async getSubmission(
    accessToken: string,
    submissionUuid: string,
  ): Promise<Record<string, unknown>> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1.0/documentsubmissions/${encodeURIComponent(submissionUuid)}`;
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
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { rawText: text };
    }
  }
}

/** Pull a document-level status string from an ETA details or submission row. */
export function extractEtaDocumentStatus(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) return null;
  const candidates = [
    payload.status,
    payload.Status,
    payload.documentStatus,
    payload.DocumentStatus,
    (payload.document as Record<string, unknown> | undefined)?.status,
    (payload.document as Record<string, unknown> | undefined)?.Status,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}
