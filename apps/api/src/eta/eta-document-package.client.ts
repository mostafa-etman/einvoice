import { etaFetch } from './eta-http';

export type EtaPackageRequestBody = {
  dateFrom: string;
  dateTo: string;
  documentTypeNames?: string[];
  statuses?: string[];
  type?: 'full' | 'summary';
  format?: 'JSON' | 'XML' | 'CSV';
};

export type EtaPackageRequestListItem = {
  requestId: string;
  status: number; // 1 in progress, 2 complete, 3 error, 4 deleted
};

export class EtaDocumentPackageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'EtaDocumentPackageError';
  }
}

/**
 * ETA Document Package APIs — paths relative to ETA_API_BASE_URL.
 * Never logs access tokens.
 */
export class EtaDocumentPackageClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  private base(): string {
    return this.apiBaseUrl.replace(/\/$/, '');
  }

  /** POST /api/v1.0/documentpackages/requests → 201 + request id */
  async requestDocumentPackage(
    accessToken: string,
    body: EtaPackageRequestBody,
  ): Promise<{ requestId: string }> {
    const url = `${this.base()}/api/v1.0/documentpackages/requests`;
    const res = await etaFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
      this.fetchImpl,
    );
    const text = await res.text();
    if (res.status !== 201 && res.status !== 200) {
      throw new EtaDocumentPackageError(
        `Request Document Package failed (${res.status})`,
        'ETA_PACKAGE_REQUEST_FAILED',
        res.status,
      );
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new EtaDocumentPackageError(
        'Non-JSON package request response',
        'ETA_BAD_RESPONSE',
        502,
      );
    }
    const requestId = String(
      parsed.requestId ?? parsed.RequestId ?? parsed.rid ?? parsed.packageId ?? '',
    );
    if (!requestId) {
      throw new EtaDocumentPackageError(
        'Package request response missing requestId',
        'ETA_BAD_RESPONSE',
        502,
      );
    }
    return { requestId };
  }

  /** GET /api/v1.0/documentpackages/requests — canonical status */
  async getPackageRequests(
    accessToken: string,
    opts?: { pageNo?: number; pageSize?: number },
  ): Promise<EtaPackageRequestListItem[]> {
    const q = new URLSearchParams();
    if (opts?.pageNo) q.set('pageNo', String(opts.pageNo));
    if (opts?.pageSize) q.set('pageSize', String(opts.pageSize));
    const qs = q.toString();
    const url = `${this.base()}/api/v1.0/documentpackages/requests${qs ? `?${qs}` : ''}`;
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
    if (res.status !== 200) {
      throw new EtaDocumentPackageError(
        `Get Package Requests failed (${res.status})`,
        'ETA_PACKAGE_LIST_FAILED',
        res.status,
      );
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rawList =
      (parsed.result as unknown[]) ??
      (parsed.Result as unknown[]) ??
      (parsed.requests as unknown[]) ??
      (Array.isArray(parsed) ? parsed : []);
    return (rawList as Record<string, unknown>[]).map((item) => ({
      requestId: String(
        item.requestId ?? item.RequestId ?? item.rid ?? item.packageId ?? '',
      ),
      status: Number(item.status ?? item.Status ?? 0),
    }));
  }

  /**
   * GET /api/v1.0/documentpackages/{rid}
   * 200 → zip bytes; 204 → not ready
   */
  async getDocumentPackage(
    accessToken: string,
    requestId: string,
  ): Promise<{ ready: false } | { ready: true; zip: Buffer }> {
    const url = `${this.base()}/api/v1.0/documentpackages/${encodeURIComponent(requestId)}`;
    const res = await etaFetch(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/zip, application/octet-stream, */*',
        },
      },
      this.fetchImpl,
    );
    if (res.status === 204) return { ready: false };
    if (res.status !== 200) {
      throw new EtaDocumentPackageError(
        `Get Document Package failed (${res.status})`,
        'ETA_PACKAGE_GET_FAILED',
        res.status,
      );
    }
    const ab = await res.arrayBuffer();
    return { ready: true, zip: Buffer.from(ab) };
  }
}

export function mapEtaPackageStatus(etaStatus: number):
  | 'IN_PROGRESS'
  | 'READY'
  | 'ERROR'
  | 'DELETED'
  | 'UNKNOWN' {
  switch (etaStatus) {
    case 1:
      return 'IN_PROGRESS';
    case 2:
      return 'READY';
    case 3:
      return 'ERROR';
    case 4:
      return 'DELETED';
    default:
      return 'UNKNOWN';
  }
}
