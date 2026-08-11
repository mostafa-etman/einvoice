import { apiFetch } from './client';
import { setAccessToken, setActiveTenantId, setSessionHint } from '@/lib/session';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthSession = {
  accessToken: string;
  expiresIn?: string;
  activeTenantId?: string | null;
  user: AuthUser;
};

function applySession(session: AuthSession) {
  setAccessToken(session.accessToken);
  setSessionHint(true);
  if (session.activeTenantId) {
    setActiveTenantId(session.activeTenantId);
  }
}

export async function register(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthSession> {
  const session = await apiFetch<AuthSession>('/auth/register', {
    method: 'POST',
    body: input,
    skipAuth: true,
  });
  applySession(session);
  return session;
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const session = await apiFetch<AuthSession>('/auth/login', {
    method: 'POST',
    body: input,
    skipAuth: true,
  });
  applySession(session);
  return session;
}

/** In-flight refresh is shared — rotate-on-use must not run twice (Strict Mode / remount). */
let refreshInFlight: Promise<AuthSession> | null = null;

export async function refresh(): Promise<AuthSession> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const session = await apiFetch<AuthSession>('/auth/refresh', {
        method: 'POST',
        skipAuth: true,
        retry: false,
      });
      applySession(session);
      return session;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
    setSessionHint(false);
  }
}
