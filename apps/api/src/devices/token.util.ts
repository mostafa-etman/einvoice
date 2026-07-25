import { randomBytes, randomUUID, createHash } from 'node:crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Never store plaintext pairing codes / device tokens — hash at rest. */
export function hashSecretToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateSecretHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Pairing codes and device tokens are `${tenantId}.${...}.${secret}` so the
 * unauthenticated agent endpoints (`/agent/pair`, device-token auth) can
 * resolve the owning tenant without a pre-auth cross-tenant lookup — every
 * tenant-scoped table here has FORCE ROW LEVEL SECURITY and the app DB role
 * has no BYPASSRLS, so a lookup by hash alone (with no `app.tenant_id` GUC
 * set) would always return zero rows. Only the (non-secret) UUID prefix is
 * used for routing; all-hash equality still gates access.
 */
export function buildPairingCode(tenantId: string): {
  code: string;
  hash: string;
  hint: string;
} {
  const secret = generateSecretHex(20);
  const code = `${tenantId}.${secret}`;
  return { code, hash: hashSecretToken(code), hint: secret.slice(-4) };
}

export function buildDeviceToken(
  tenantId: string,
  deviceId: string,
): { token: string; hash: string } {
  const secret = generateSecretHex(32);
  const token = `${tenantId}.${deviceId}.${secret}`;
  return { token, hash: hashSecretToken(token) };
}

/** Parses a dot-delimited, tenant-prefixed token; returns null if malformed. */
export function parseTenantPrefixedToken(
  raw: string | undefined | null,
  expectedParts: number,
): string[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parts = raw.split('.');
  if (parts.length !== expectedParts) return null;
  if (!UUID_RE.test(parts[0] ?? '')) return null;
  // 3-part tokens are `${tenantId}.${deviceId}.${secret}` — deviceId is also a UUID.
  if (expectedParts === 3 && !UUID_RE.test(parts[1] ?? '')) return null;
  return parts;
}

/** Hash that can never match a real token — used to clear a revoked device's tokenHash. */
export function unusableTokenHash(): string {
  return hashSecretToken(randomUUID());
}
