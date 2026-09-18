/**
 * ETA POS JWT carries TaxProfTags (e.g. "B2C"). Receipt submit is refused
 * without the B2C tag — surface that as a self-service profile error.
 */

export const ETA_B2C_REQUIRED_CODE = 'ETA_B2C_REQUIRED';

export const ETA_B2C_REQUIRED_MESSAGE =
  'Enable B2C on your ETA taxpayer profile before submitting receipts. The platform cannot enable this for you.';

export function jwtPayload(accessToken: string): Record<string, unknown> | null {
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function jwtHasB2cTag(accessToken: string): boolean {
  const payload = jwtPayload(accessToken);
  if (!payload) return false;
  const raw =
    payload.TaxProfTags ??
    payload.taxProfTags ??
    payload.TaxProfTag ??
    payload.tags;
  const text = Array.isArray(raw) ? raw.map(String).join(' ') : String(raw ?? '');
  return text.toUpperCase().includes('B2C');
}
