import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import {
  assertReceivedDirection,
  formatEtaDateTimeIssued,
  receivedDirectionQuery,
} from '@einvoice/eta-core';

export type EtaDocumentsSearchPage = {
  result: Record<string, unknown>[];
  continuationToken?: string | null;
  raw: unknown;
};

export type EtaSearchDateWindow = {
  /** Inclusive start — ETA submissionDateFrom / issueDateFrom. */
  from: Date | string;
  /** Inclusive end — ETA submissionDateTo / issueDateTo. */
  to: Date | string;
  /** Prefer submission dates (default) or issue dates. */
  dateField?: 'submission' | 'issue';
};

export type EtaDocumentDirection = 'Received' | 'Sent';

/**
 * GET /api/v1.0/documents/search
 * ETA requires submissionDateFrom/To OR issueDateFrom/To (max 30-day span).
 */
export class EtaDocumentsSearchClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  /** Purchases — always direction=Received. */
  async searchReceived(
    accessToken: string,
    opts: {
      pageSize?: number;
      continuationToken?: string;
      documentType?: string;
      status?: string;
      window: EtaSearchDateWindow;
    },
  ): Promise<EtaDocumentsSearchPage> {
    return this.search(accessToken, { ...opts, direction: 'Received' });
  }

  /** Issued / sales — direction=Sent. */
  async searchSent(
    accessToken: string,
    opts: {
      pageSize?: number;
      continuationToken?: string;
      documentType?: string;
      status?: string;
      window: EtaSearchDateWindow;
    },
  ): Promise<EtaDocumentsSearchPage> {
    return this.search(accessToken, { ...opts, direction: 'Sent' });
  }

  async search(
    accessToken: string,
    opts: {
      direction: EtaDocumentDirection;
      pageSize?: number;
      continuationToken?: string;
      documentType?: string;
      status?: string;
      window: EtaSearchDateWindow;
    },
  ): Promise<EtaDocumentsSearchPage> {
    const dateParams = this.buildDateParams(opts.window);
    const params =
      opts.direction === 'Received'
        ? receivedDirectionQuery({
            pageSize: opts.pageSize ?? 100,
            continuationToken: opts.continuationToken,
            documentType: opts.documentType,
            status: opts.status,
            ...dateParams,
          })
        : {
            direction: 'Sent',
            pageSize: String(opts.pageSize ?? 100),
            ...(opts.continuationToken
              ? { continuationToken: opts.continuationToken }
              : {}),
            ...(opts.documentType ? { documentType: opts.documentType } : {}),
            ...(opts.status ? { status: opts.status } : {}),
            ...dateParams,
          };
    if (opts.direction === 'Received') {
      assertReceivedDirection(params);
    }

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
      const err = new Error(mapped.message) as Error & {
        status?: number;
        etaCode?: string;
      };
      err.status = mapped.httpStatus;
      err.etaCode = mapped.code;
      throw err;
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
    // ETA uses "EndofResultSet" when finished — treat as no further pages.
    const done =
      !continuationToken ||
      continuationToken === 'EndofResultSet' ||
      continuationToken === 'EndOfResultSet';
    return {
      result,
      continuationToken: done ? null : continuationToken,
      raw,
    };
  }

  private buildDateParams(
    window: EtaSearchDateWindow,
  ): Record<string, string> {
    const field = window.dateField ?? 'submission';
    const from = formatEtaDateTimeIssued(window.from);
    const to = formatEtaDateTimeIssued(window.to);
    if (field === 'issue') {
      return { issueDateFrom: from, issueDateTo: to };
    }
    return { submissionDateFrom: from, submissionDateTo: to };
  }
}

/** Split [from, to] into ≤ maxDays windows (ETA Search limit is 30 days). */
export function buildEtaSearchWindows(
  from: Date,
  to: Date,
  maxDays = 30,
): Array<{ from: Date; to: Date }> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Invalid sync date range');
  }
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;
  const ms = maxDays * 24 * 60 * 60 * 1000;
  const windows: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = new Date(
      Math.min(cursor.getTime() + ms - 1, end.getTime()),
    );
    windows.push({ from: new Date(cursor.getTime()), to: windowEnd });
    cursor = new Date(windowEnd.getTime() + 1);
  }
  return windows.length ? windows : [{ from: start, to: end }];
}
