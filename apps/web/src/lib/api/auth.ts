import { apiFetch } from './client';
import { setAccessToken, setSessionHint } from '@/lib/session';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthSession = {
  accessToken: string;
  expiresIn?: string;
  user: AuthUser;
};

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
  setAccessToken(session.accessToken);
  setSessionHint(true);
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
  setAccessToken(session.accessToken);
  setSessionHint(true);
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
      setAccessToken(session.accessToken);
      setSessionHint(true);
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
