import { etaFetch } from './eta-http';
import { mapEtaHttpError } from './eta-errors';
import type { Eta202Body } from '../submissions/submission-202-result-map';
import { parseDuplicateSubmission } from '../submissions/duplicate-submission';

export class EtaSubmitError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly bodyText?: string,
    readonly retryAfterSeconds?: number,
    readonly isDuplicate?: boolean,
  ) {
    super(message);
    this.name = 'EtaSubmitError';
  }
}

/**
 * POST /api/v1.0/documentsubmissions — never logs access tokens.
 */
export class EtaSubmitClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiBaseUrl) throw new Error('ETA_API_BASE_URL is required');
  }

  async postDocumentSubmissions(
    accessToken: string,
    documents: Record<string, unknown>[],
  ): Promise<Eta202Body> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    // Preprod returns 404 when a trailing slash is present; use no trailing slash.
    const url = `${base}/api/v1.0/documentsubmissions`;
    const res = await etaFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ documents }),
      },
      this.fetchImpl,
    );

    const text = await res.text();
    if (res.status !== 202) {
      const mapped = mapEtaHttpError(res.status, text);
      const dup = parseDuplicateSubmission(
        res.status,
        text,
        res.headers.get('retry-after'),
      );
      throw new EtaSubmitError(
        `${mapped.message} (POST ${url})`,
        dup.isDuplicate ? 'ETA_DUPLICATE_SUBMISSION' : mapped.code,
        mapped.httpStatus,
        text.slice(0, 2000),
        dup.isDuplicate ? dup.retryAfterSeconds : undefined,
        dup.isDuplicate,
      );
    }

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

    const acceptedDocuments = (parsed.acceptedDocuments ??
      parsed.AcceptedDocuments ??
      []) as NonNullable<Eta202Body['acceptedDocuments']>;
    const rejectedDocuments = (parsed.rejectedDocuments ??
      parsed.RejectedDocuments ??
      []) as NonNullable<Eta202Body['rejectedDocuments']>;

    const submissionUUID =
      typeof rawSubmissionId === 'string' && rawSubmissionId.length > 0
        ? rawSubmissionId
        : '';

    // ETA returns submissionId:null when the whole batch is refused at intake.
    if (
      !submissionUUID &&
      acceptedDocuments.length === 0 &&
      rejectedDocuments.length === 0
    ) {
      throw new EtaSubmitError(
        `ETA 202 missing submissionUUID and document arrays; keys=${Object.keys(parsed).join(',') || '(none)'}; body=${text.slice(0, 400)}`,
        'eta_bad_response',
        502,
        text.slice(0, 2000),
      );
    }

    const body: Eta202Body = {
      submissionUUID: submissionUUID || `intake-refused-${Date.now()}`,
      acceptedDocuments,
      rejectedDocuments,
    };

    return body;
  }
}
