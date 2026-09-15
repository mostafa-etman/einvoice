import { HttpException, HttpStatus } from '@nestjs/common';

export type QuotaResource = 'documents' | 'branches' | 'devices';

/** Thrown by QuotaService when a mutate path would push usage past the effective limit. */
export class QuotaExceededError extends Error {
  constructor(
    public readonly resource: QuotaResource,
    public readonly used: number,
    public readonly limit: number,
    public readonly whatsappUrl?: string,
    public readonly whatsappDisplay?: string,
  ) {
    const pooled = resource === 'branches' || resource === 'devices';
    const via = whatsappDisplay ? ` via WhatsApp ${whatsappDisplay}` : '';
    super(
      pooled
        ? `${resource === 'branches' ? 'Branch' : 'Device'} limit reached (${used}/${limit}). Upgrade or buy an add-on${via}`
        : `Quota exceeded for ${resource}: ${used}/${limit} used this period`,
    );
    this.name = 'QuotaExceededError';
  }
}

export type QuotaExceededBody = {
  code: 'QUOTA_EXCEEDED';
  resource: QuotaResource;
  used: number;
  limit: number;
  message: string;
  whatsappUrl?: string;
  whatsappDisplay?: string;
};

/** Stable API error body shared by every quota-enforced endpoint (billing-api.yaml QuotaExceededError). */
export function quotaExceededBody(err: QuotaExceededError): QuotaExceededBody {
  return {
    code: 'QUOTA_EXCEEDED',
    resource: err.resource,
    used: err.used,
    limit: err.limit,
    message: err.message,
    ...(err.whatsappUrl ? { whatsappUrl: err.whatsappUrl } : {}),
    ...(err.whatsappDisplay ? { whatsappDisplay: err.whatsappDisplay } : {}),
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
