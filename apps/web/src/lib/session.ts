type TokenListener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<TokenListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((l) => l(token));
}

export function subscribeAccessToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const TENANT_KEY = 'einvoice.activeTenantId';
const BRANCH_KEY = 'einvoice.activeBranchId';
/**
 * Non-secret hint that an HttpOnly refresh cookie may exist on the API host.
 * The cookie itself is not readable from JS; without this flag AuthProvider
 * would POST /auth/refresh on every cold open and get 401 "Missing refresh token".
 */
const SESSION_HINT_KEY = 'einvoice.hasSession';

export function getSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SESSION_HINT_KEY) === '1';
}

export function setSessionHint(hasSession: boolean) {
  if (typeof window === 'undefined') return;
  if (hasSession) localStorage.setItem(SESSION_HINT_KEY, '1');
  else localStorage.removeItem(SESSION_HINT_KEY);
}

export function getActiveTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TENANT_KEY);
}

export function setActiveTenantId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(TENANT_KEY, id);
  else localStorage.removeItem(TENANT_KEY);
}

export function getActiveBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(BRANCH_KEY);
}

export function setActiveBranchId(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(BRANCH_KEY, id);
  else localStorage.removeItem(BRANCH_KEY);
}
