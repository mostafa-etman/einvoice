import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import { parseDuplicateSubmission } from '../submissions/duplicate-submission';
import { EtaSubmitError } from './eta-submit.client';

export type ReceiptAccepted = {
  uuid?: string;
  longId?: string;
  receiptNumber?: string;
};

export type ReceiptRejected = {
  uuid?: string;
  receiptNumber?: string;
  error?: { message?: string; target?: string; propertyPath?: string; code?: string };
};

export type Receipt202Body = {
  submissionUUID: string;
  acceptedDocuments: ReceiptAccepted[];
  rejectedDocuments: ReceiptRejected[];
};

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function mapAccepted(row: Record<string, unknown>): ReceiptAccepted {
  return {
    uuid: row.uuid != null ? String(row.uuid) : undefined,
    longId: row.longId != null ? String(row.longId) : row.longID != null ? String(row.longID) : undefined,
    receiptNumber:
      row.receiptNumber != null
        ? String(row.receiptNumber)
        : row.receiptnumber != null
          ? String(row.receiptnumber)
          : undefined,
  };
}

function mapRejected(row: Record<string, unknown>): ReceiptRejected {
  const err = (row.error ?? row.Error) as Record<string, unknown> | undefined;
  return {
    uuid: row.uuid != null ? String(row.uuid) : undefined,
    receiptNumber:
      row.receiptNumber != null ? String(row.receiptNumber) : undefined,
    error: err
      ? {
          message: err.message != null ? String(err.message) : undefined,
          target: err.target != null ? String(err.target) : undefined,
          propertyPath:
            err.propertyPath != null ? String(err.propertyPath) : undefined,
          code: err.code != null ? String(err.code) : undefined,
        }
      : undefined,
  };
}

function parse202(text: string): Receipt202Body {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new EtaSubmitError(
      'ETA returned 202 with non-JSON body',
      'eta_bad_response',
      502,
      text.slice(0, 500),
    );
  }

  const rawSubmissionId =
    parsed.submissionUUID ??
    parsed.submissionUuid ??
    parsed.SubmissionUUID ??
    parsed.submissionId ??
    parsed.SubmissionId;

  const acceptedDocuments = asList(
    parsed.acceptedDocuments ?? parsed.AcceptedDocuments,
  ).map(mapAccepted);
  const rejectedDocuments = asList(
    parsed.rejectedDocuments ?? parsed.RejectedDocuments,
  ).map(mapRejected);

  const submissionUUID =
    typeof rawSubmissionId === 'string' && rawSubmissionId.length > 0
      ? rawSubmissionId
      : '';

  if (
    !submissionUUID &&
    acceptedDocuments.length === 0 &&
    rejectedDocuments.length === 0
  ) {
    throw new EtaSubmitError(
      `ETA 202 missing submissionUUID and document arrays; keys=${Object.keys(parsed).join(',') || '(none)'}`,
      'eta_bad_response',
      502,
      text.slice(0, 2000),
    );
  }

  return {
    submissionUUID: submissionUUID || `intake-refused-${Date.now()}`,
    acceptedDocuments,
    rejectedDocuments,
  };
}

function throwMapped(res: Response, url: string, text: string): never {
  const mapped = mapEtaHttpError(res.status, text);
  const dup = parseDuplicateSubmission(
    res.status,
    text,
    res.headers.get('retry-after'),
  );
  const code =
    res.status === 403
      ? 'ETA_INCORRECT_SUBMITTER'
      : /badstructure/i.test(text)
        ? 'ETA_BAD_STRUCTURE'
        : /maximumsizeexceeded/i.test(text)
          ? 'ETA_MAXIMUM_SIZE_EXCEEDED'
          : dup.isDuplicate
            ? 'ETA_DUPLICATE_SUBMISSION'
            : mapped.code;
  throw new EtaSubmitError(
    `${mapped.message} (POST ${url})`,
    code,
    mapped.httpStatus,
    text.slice(0, 2000),
    dup.isDuplicate ? dup.retryAfterSeconds : undefined,
    dup.isDuplicate,
  );
}

/**
 * POST /api/v1/receiptsubmissions — never logs access tokens.
 * Invoice EtaSubmitClient (documentsubmissions) is untouched.
 */
export class EtaReceiptSubmitClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async postReceiptSubmissions(
    accessToken: string,
    body: { receipts: unknown[]; signatures: unknown[] },
  ): Promise<Receipt202Body> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1/receiptsubmissions`;
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
    if (res.status !== 202) {
      throwMapped(res, url, text);
    }
    return parse202(text);
  }
}
