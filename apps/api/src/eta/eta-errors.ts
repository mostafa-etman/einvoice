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

export function mapEtaHttpError(status: number, text: string): EtaMappedError {
  return {
    code: 'eta_upstream_error',
    message: text.slice(0, 200) || `ETA returned HTTP ${status}`,
    httpStatus: status >= 500 ? 502 : status,
  };
}
