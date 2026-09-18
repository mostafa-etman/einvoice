import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import { extractEtaDocumentStatus } from './eta-submission-status.client';

/**
 * Poll eReceipt submission / receipt details. Invoice document-submission
 * status client is untouched.
 */
export class EtaReceiptStatusClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async getSubmissionDetails(
    accessToken: string,
    submissionUuid: string,
  ): Promise<Record<string, unknown>> {
    return this.getJson(
      accessToken,
      `/api/v1/receiptsubmissions/${encodeURIComponent(submissionUuid)}/details`,
    );
  }

  async getReceiptDetails(
    accessToken: string,
    uuid: string,
  ): Promise<Record<string, unknown>> {
    return this.getJson(
      accessToken,
      `/api/v1/receipts/${encodeURIComponent(uuid)}/details`,
    );
  }

  private async getJson(
    accessToken: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}${path}`;
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

export function extractReceiptEtaStatus(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) return null;
  const direct = extractEtaDocumentStatus(payload);
  if (direct) return direct;
  const nested = payload.receipts ?? payload.Receipts ?? payload.documents;
  if (Array.isArray(nested) && nested[0] && typeof nested[0] === 'object') {
    return extractEtaDocumentStatus(nested[0] as Record<string, unknown>);
  }
  return null;
}

export function normalizeReceiptEtaStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().toUpperCase().replace(/[\s_-]/g, '');
  if (u === 'VALID') return 'Valid';
  if (u === 'INVALID') return 'Invalid';
  if (u === 'INPROGRESS' || u === 'SUBMITTED' || u === 'PENDING') return 'InProgress';
  if (u === 'CANCELLED' || u === 'CANCELED') return 'Cancelled';
  return raw.trim();
}
