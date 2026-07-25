import { etaFetch } from './eta-http';
import { mapEtaOAuthError } from './eta-errors';

/** Build ETA OAuth2 Basic Authorization header value (without "Basic " prefix). */
export function buildBasicAuthHeaderValue(
  clientId: string,
  clientSecret: string,
): string {
  return Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

export function buildBasicAuthHeader(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${buildBasicAuthHeaderValue(clientId, clientSecret)}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

export class EtaAuthClient {
  constructor(
    private readonly identityBaseUrl: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!identityBaseUrl) {
      throw new Error('ETA_IDENTITY_BASE_URL is required');
    }
  }

  private getFetch(): typeof fetch {
    return this.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Never log clientSecret or access_token. */
  async requestToken(input: {
    clientId: string;
    clientSecret: string;
    onBehalfOf?: string | null;
  }): Promise<TokenResponse> {
    const url = `${this.identityBaseUrl.replace(/\/$/, '')}/connect/token`;
    const headers: Record<string, string> = {
      Authorization: buildBasicAuthHeader(input.clientId, input.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (input.onBehalfOf) {
      headers.onbehalfof = input.onBehalfOf;
    }
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const res = await etaFetch(
      url,
      { method: 'POST', headers, body },
      this.getFetch(),
    );
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const mapped = mapEtaOAuthError(
        json as { error?: string; error_description?: string } | null,
        res.status,
      );
      const err = new Error(mapped.message) as Error & {
        etaCode?: string;
        status?: number;
      };
      err.etaCode = mapped.code;
      err.status = mapped.httpStatus;
      throw err;
    }
    const access_token = String(json?.access_token ?? '');
    const expires_in = Number(json?.expires_in ?? 0);
    if (!access_token || !expires_in) {
      throw new Error('ETA token response missing access_token or expires_in');
    }
    return {
      access_token,
      expires_in,
      token_type: json?.token_type ? String(json.token_type) : undefined,
      scope: json?.scope ? String(json.scope) : undefined,
    };
  }
}
