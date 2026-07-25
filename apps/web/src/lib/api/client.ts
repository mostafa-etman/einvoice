import {
  getAccessToken,
  getActiveTenantId,
  setAccessToken,
} from '@/lib/session';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Always the API origin (e.g. https://api.localhost) — never the web origin. */
export function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_URL is required');
  }
  const normalized = base.replace(/\/$/, '');
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    normalized.startsWith('http://')
  ) {
    throw new Error(
      `NEXT_PUBLIC_API_URL must be HTTPS when the app is served over HTTPS (got ${normalized}). ` +
        'Use https://api.localhost — Secure cookies are dropped on HTTP origins.',
    );
  }
  return normalized;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  tenantScoped?: boolean;
  skipAuth?: boolean;
  retry?: boolean;
};

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${apiBase()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return data.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Global API client: every call uses credentials:'include' so the browser
 * stores and sends the HttpOnly refresh cookie on https://api.localhost.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let token = getAccessToken();
  if (!options.skipAuth && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.tenantScoped) {
    const tenantId = getActiveTenantId();
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
  }

  const res = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !options.skipAuth && options.retry !== false) {
    token = await refreshAccessToken();
    if (token) {
      return apiFetch<T>(path, { ...options, retry: false });
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    throw new ApiError(
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: unknown }).message)
        : res.statusText,
      res.status,
      data,
    );
  }
  return data as T;
}
