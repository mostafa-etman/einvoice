import { HttpException, HttpStatus } from '@nestjs/common';

export type QuotaResource = 'documents' | 'branches' | 'devices';

/** Thrown by QuotaService when a mutate path would push usage past the effective limit. */
export class QuotaExceededError extends Error {
  constructor(
    public readonly resource: QuotaResource,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`Quota exceeded for ${resource}: ${used}/${limit} used this period`);
    this.name = 'QuotaExceededError';
  }
}

export type QuotaExceededBody = {
  code: 'QUOTA_EXCEEDED';
  resource: QuotaResource;
  used: number;
  limit: number;
  message: string;
};

/** Stable API error body shared by every quota-enforced endpoint (billing-api.yaml QuotaExceededError). */
export function quotaExceededBody(err: QuotaExceededError): QuotaExceededBody {
  return {
    code: 'QUOTA_EXCEEDED',
    resource: err.resource,
    used: err.used,
    limit: err.limit,
    message: err.message,
  };
}

/** HTTP wrapper so controllers/services can `throw new QuotaExceededHttpException(err)` directly. */
export class QuotaExceededHttpException extends HttpException {
  constructor(err: QuotaExceededError) {
    super(quotaExceededBody(err), HttpStatus.CONFLICT);
  }
}

export function isQuotaExceededError(err: unknown): err is QuotaExceededError {
  return err instanceof QuotaExceededError;
}
