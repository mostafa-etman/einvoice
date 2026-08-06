import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';

export class EtaDocumentLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'EtaDocumentLifecycleError';
  }
}

/**
 * Shared Phase 6 / Purchases ETA document state client.
 * PUT /api/v1.0/documents/state/{uuid}/state
 * PUT /api/v1.0/documents/state/{uuid}/decline/cancelation
 * PUT /api/v1.0/documents/state/{uuid}/decline/rejection
 */
export class EtaDocumentLifecycleClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  private base(): string {
    return this.apiBaseUrl.replace(/\/$/, '');
  }

  async rejectDocument(
    accessToken: string,
    documentUuid: string,
    reason: string,
  ): Promise<void> {
    await this.putState(accessToken, documentUuid, {
      status: 'rejected',
      reason,
    });
  }

  async cancelDocument(
    accessToken: string,
    documentUuid: string,
    reason: string,
  ): Promise<void> {
    await this.putState(accessToken, documentUuid, {
      status: 'cancelled',
      reason,
    });
  }

  private async putState(
    accessToken: string,
    documentUuid: string,
    body: { status: string; reason: string },
  ): Promise<void> {
    const url = `${this.base()}/api/v1.0/documents/state/${encodeURIComponent(documentUuid)}/state`;
    const res = await etaFetch(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
      this.fetchImpl,
    );
    await this.assertOk(res, body.status === 'cancelled' ? 'cancel' : 'reject');
  }

  async declineCancelation(
    accessToken: string,
    documentUuid: string,
  ): Promise<void> {
    const url = `${this.base()}/api/v1.0/documents/state/${encodeURIComponent(documentUuid)}/decline/cancelation`;
    const res = await etaFetch(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      this.fetchImpl,
    );
    await this.assertOk(res, 'decline_cancelation');
  }

  async declineRejection(
    accessToken: string,
    documentUuid: string,
  ): Promise<void> {
    const url = `${this.base()}/api/v1.0/documents/state/${encodeURIComponent(documentUuid)}/decline/rejection`;
    const res = await etaFetch(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
      this.fetchImpl,
    );
    await this.assertOk(res, 'decline_rejection');
  }

  private async assertOk(res: Response, op: string): Promise<void> {
    if (res.ok) return;
    const text = await res.text();
    const mapped = mapEtaHttpError(res.status, text);
    throw new EtaDocumentLifecycleError(
      mapped.message,
      `eta_lifecycle_${op}`,
      res.status,
      text.slice(0, 2000),
    );
  }
}
