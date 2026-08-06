import { etaFetch } from './eta-http';

/** Caller-facing (product) shape; casing is normalised before hitting ETA. */
export type EtaPackageRequestBody = {
  dateFrom: string;
  dateTo: string;
  documentTypeNames?: string[];
  statuses?: string[];
  type?: string;
  format?: string;
  truncateIfExceeded?: boolean;
  branchNumber?: string;
  receiverSenderType?: string;
  receiverSenderId?: string;
};

/** Exact wire shape ETA accepts: filters live under `queryParameters`. */
export type EtaPackageRequestPayload = {
  type: 'Full' | 'Summary';
  format: 'JSON' | 'XML' | 'CSV';
  queryParameters: {
    dateFrom: string;
    dateTo: string;
    documentTypeNames?: string[];
    statuses?: string[];
    branchNumber?: string;
    receiverSenderType?: string;
    receiverSenderId?: string;
    truncateifexceeded: boolean;
  };
};

export type EtaPackageRequestListItem = {
  requestId: string;
  status: number; // 1 in progress, 2 complete, 3 error, 4 deleted
};

export class EtaDocumentPackageError extends Error {
  readonly etaCode?: string;
  readonly details: string[];
  readonly correlationId?: string;

  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    extra?: { etaCode?: string; details?: string[]; correlationId?: string },
  ) {
    super(message);
    this.name = 'EtaDocumentPackageError';
    this.etaCode = extra?.etaCode;
    this.details = extra?.details ?? [];
    this.correlationId = extra?.correlationId;
  }
}

const PACKAGE_TYPES = new Set(['Full', 'Summary']);
const PACKAGE_FORMATS = new Set(['JSON', 'XML', 'CSV']);
const DOCUMENT_TYPE_NAMES = new Set(['I', 'C', 'D']);
const DOCUMENT_STATUSES = new Set(['Valid', 'Invalid', 'Rejected', 'Cancelled']);

function pascal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed[0]!.toUpperCase() + trimmed.slice(1).toLowerCase();
}

function badArgument(message: string): EtaDocumentPackageError {
  return new EtaDocumentPackageError(message, 'ETA_PACKAGE_BAD_ARGUMENT', 400);
}

function isoOrThrow(value: string, field: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw badArgument(`${field} must be a valid date`);
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * ETA rejects lowercase enum values ("Invalid Package Type"/"Invalid Package
 * Format"/"Invalid Status") and ignores filters that are not nested under
 * `queryParameters`, so normalise both before sending.
 */
export function buildPackageRequestPayload(
  input: EtaPackageRequestBody,
): EtaPackageRequestPayload {
  const type = pascal(input.type ?? 'Full') as 'Full' | 'Summary';
  if (!PACKAGE_TYPES.has(type)) {
    throw badArgument(`Package type must be Full or Summary (got "${input.type}")`);
  }

  const format = (input.format ?? 'JSON').trim().toUpperCase() as
    | 'JSON'
    | 'XML'
    | 'CSV';
  if (!PACKAGE_FORMATS.has(format)) {
    throw badArgument(`Package format must be JSON, XML or CSV (got "${input.format}")`);
  }
  if (format === 'CSV' && type !== 'Summary') {
    throw badArgument('CSV packages are only available for Summary type');
  }

  const dateFrom = isoOrThrow(input.dateFrom, 'dateFrom');
  const dateTo = isoOrThrow(input.dateTo, 'dateTo');
  if (new Date(dateFrom).getTime() > new Date(dateTo).getTime()) {
    throw badArgument('dateFrom must be before dateTo');
  }

  const documentTypeNames = input.documentTypeNames?.length
    ? input.documentTypeNames.map((name) => {
        const upper = name.trim().toUpperCase();
        if (!DOCUMENT_TYPE_NAMES.has(upper)) {
          throw badArgument(`Document type must be I, C or D (got "${name}")`);
        }
        return upper;
      })
    : undefined;

  const statuses = input.statuses?.length
    ? input.statuses.map((status) => {
        const cased = pascal(status);
        if (!DOCUMENT_STATUSES.has(cased)) {
          throw badArgument(
            `Status must be Valid, Invalid, Rejected or Cancelled (got "${status}")`,
          );
        }
        return cased;
      })
    : undefined;

  return {
    type,
    format,
    queryParameters: {
      dateFrom,
      dateTo,
      ...(documentTypeNames ? { documentTypeNames } : {}),
      ...(statuses ? { statuses } : {}),
      ...(input.branchNumber ? { branchNumber: input.branchNumber } : {}),
      ...(input.receiverSenderType
        ? { receiverSenderType: input.receiverSenderType }
        : {}),
      ...(input.receiverSenderId
        ? { receiverSenderId: input.receiverSenderId }
        : {}),
      truncateifexceeded: input.truncateIfExceeded ?? true,
    },
  };
}

type EtaErrorEnvelope = {
  error?: {
    code?: string | null;
    message?: string | null;
    target?: string | null;
    details?: Array<{
      code?: string | null;
      target?: string | null;
      message?: string | null;
    }> | null;
  };
};

/** Turn ETA's error envelope into a readable message + machine-usable parts. */
export function parseEtaPackageError(
  text: string,
  httpStatus: number,
  fallbackCode: string,
  operation: string,
): EtaDocumentPackageError {
  let envelope: EtaErrorEnvelope | null = null;
  try {
    envelope = text ? (JSON.parse(text) as EtaErrorEnvelope) : null;
  } catch {
    envelope = null;
  }

  const etaCode = envelope?.error?.code ?? undefined;
  const details = (envelope?.error?.details ?? [])
    .map((d) => [d?.target, d?.message].filter(Boolean).join(': '))
    .filter((d) => d.length > 0);
  const topMessage = envelope?.error?.message ?? undefined;

  const correlationId = /correlation id:\s*\[([^\]]+)\]/i.exec(
    details.join(' ') || text || '',
  )?.[1];

  const summary =
    details.join('; ') ||
    topMessage ||
    (text ? text.slice(0, 200) : `HTTP ${httpStatus}`);

  const code =
    etaCode === 'OperationExceedsLimit'
      ? 'ETA_PACKAGE_EXCEEDS_LIMIT'
      : httpStatus === 401
        ? 'ETA_UNAUTHORIZED'
        : httpStatus === 403
          ? 'ETA_FORBIDDEN'
          : httpStatus === 400
            ? 'ETA_PACKAGE_BAD_ARGUMENT'
            : fallbackCode;

  return new EtaDocumentPackageError(
    `${operation} failed (${httpStatus}): ${summary}`,
    code,
    httpStatus,
    { etaCode: etaCode ?? undefined, details, correlationId },
  );
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
    const payload = buildPackageRequestPayload(body);
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
        body: JSON.stringify(payload),
      },
      this.fetchImpl,
    );
    const text = await res.text();
    if (res.status !== 201 && res.status !== 200) {
      throw parseEtaPackageError(
        text,
        res.status,
        'ETA_PACKAGE_REQUEST_FAILED',
        'Request Document Package',
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
    const requestId = readRequestId(parsed);
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
      throw parseEtaPackageError(
        text,
        res.status,
        'ETA_PACKAGE_LIST_FAILED',
        'Get Package Requests',
      );
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new EtaDocumentPackageError(
        'Non-JSON package requests response',
        'ETA_BAD_RESPONSE',
        502,
      );
    }
    return readRequestList(parsed);
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
    if (res.status === 204 || res.status === 202) return { ready: false };
    if (res.status !== 200) {
      const text = await res.text().catch(() => '');
      throw parseEtaPackageError(
        text,
        res.status,
        'ETA_PACKAGE_GET_FAILED',
        'Get Document Package',
      );
    }
    const ab = await res.arrayBuffer();
    // ETA occasionally answers 200 with an empty body while still assembling.
    if (ab.byteLength === 0) return { ready: false };
    return { ready: true, zip: Buffer.from(ab) };
  }
}

/** ETA names this `packageId`; older sandbox builds used `requestId`. */
function readRequestId(item: Record<string, unknown>): string {
  const candidate =
    item.packageId ??
    item.PackageId ??
    item.requestId ??
    item.RequestId ??
    item.requestID ??
    item.rid ??
    item.id;
  return candidate == null ? '' : String(candidate);
}

function readRequestList(parsed: unknown): EtaPackageRequestListItem[] {
  const container = (parsed ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(parsed)
    ? parsed
    : ((container.result as unknown[]) ??
      (container.Result as unknown[]) ??
      (container.requests as unknown[]) ??
      []);
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      requestId: readRequestId(item),
      status: Number(item.status ?? item.Status ?? 0),
    }))
    .filter((item) => item.requestId.length > 0);
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
