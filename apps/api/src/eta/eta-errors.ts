export type EtaMappedError = {
  code: string;
  message: string;
  httpStatus: number;
};

const OAUTH_MESSAGES: Record<string, string> = {
  invalid_client: 'ETA rejected the Client ID or Client Secret.',
  invalid_grant: 'ETA rejected the grant; check credentials and on-behalf-of.',
  unauthorized_client: 'This client is not authorized for ETA client credentials.',
  invalid_request: 'The ETA token request was invalid.',
};

export function mapEtaOAuthError(
  body: { error?: string; error_description?: string } | null,
  httpStatus: number,
): EtaMappedError {
  const code = body?.error || (httpStatus === 401 ? 'unauthorized' : 'eta_error');
  const message =
    OAUTH_MESSAGES[code] ||
    body?.error_description ||
    'ETA authentication failed.';
  return {
    code,
    message,
    httpStatus: httpStatus >= 400 && httpStatus < 600 ? httpStatus : 502,
  };
}

/** Flatten nested ETA JSON so callers never see "[object Object]". */
export function stringifyEtaDetail(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (item == null) return undefined;
        if (typeof item === 'string') return item.trim() || undefined;
        if (typeof item === 'object') {
          const row = item as Record<string, unknown>;
          const target = stringifyEtaDetail(row.target ?? row.property);
          const msg = stringifyEtaDetail(
            row.message ?? row.msg ?? row.description ?? row.detail,
          );
          if (target && msg) return `${target}: ${msg}`;
          return msg ?? target ?? JSON.stringify(item);
        }
        return String(item);
      })
      .filter((p): p is string => Boolean(p));
    return parts.length ? parts.join('; ') : undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const nestedMsg = stringifyEtaDetail(
      obj.message ?? obj.Message ?? obj.detail ?? obj.title,
    );
    const details = stringifyEtaDetail(obj.details ?? obj.Details);
    const code =
      typeof obj.code === 'string'
        ? obj.code
        : typeof obj.Code === 'string'
          ? obj.Code
          : undefined;
    const parts = [code, nestedMsg, details].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function mapEtaHttpError(status: number, text: string): EtaMappedError {
  let detail = text.slice(0, 800);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    detail =
      stringifyEtaDetail(parsed.error) ||
      stringifyEtaDetail(parsed.message) ||
      stringifyEtaDetail(parsed.detail) ||
      stringifyEtaDetail(parsed.title) ||
      stringifyEtaDetail(parsed.errors) ||
      detail;
  } catch {
    /* keep raw slice */
  }
  if (detail && typeof detail !== 'string') {
    detail = stringifyEtaDetail(detail) || String(detail);
  }
  if (status === 429) {
    return {
      code: 'eta_rate_limited',
      message: `ETA HTTP 429: Too many requests — ${detail || 'rate limited'}`.slice(
        0,
        800,
      ),
      httpStatus: 429,
    };
  }
  return {
    code: 'eta_upstream_error',
    message: `ETA HTTP ${status}: ${detail}`.slice(0, 800),
    httpStatus: status >= 500 ? 502 : status,
  };
}
