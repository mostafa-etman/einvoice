/**
 * Issuer identity (name / id / type) resolution.
 *
 * The issuer is the seller — our own company. Name and registration number
 * belong to tenant/company settings, not the branch. A blank per-document
 * override never erases the settings value.
 */

export type IssuerType = 'B' | 'P' | 'F';

export const ETA_ISSUER_TYPES = ['B', 'P', 'F'] as const;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when `name` is a usable taxpayer legal name — not blank and not a
 * leftover branch label like "Main".
 */
export function isIssuerNameComplete(
  name: string | null | undefined,
  branchName?: string | null,
): boolean {
  const n = clean(name);
  if (!n) return false;
  const branch = clean(branchName);
  if (branch && n.toLowerCase() === branch.toLowerCase()) return false;
  return true;
}

/**
 * Resolve issuer.name: settings (tenant legal name) wins over blank overrides
 * and over leftover branch labels like "Main". Never falls back to branch.name.
 */
export function resolveIssuerName(
  settingsLegalName: string | null | undefined,
  documentOverride?: string | null,
  branchName?: string | null,
): string {
  const fromDoc = clean(documentOverride);
  if (fromDoc && isIssuerNameComplete(fromDoc, branchName)) return fromDoc;
  return clean(settingsLegalName);
}

/** Resolve issuer.id (registration number). Blank override → settings. */
export function resolveIssuerId(
  settingsRegistrationNumber: string | null | undefined,
  documentOverride?: string | null,
): string {
  const fromDoc = clean(documentOverride);
  if (fromDoc) return fromDoc;
  return clean(settingsRegistrationNumber);
}

/** Resolve issuer.type (B/P/F). Blank override → settings → 'B'. */
export function resolveIssuerType(
  settingsType: string | null | undefined,
  documentOverride?: string | null,
): IssuerType {
  const fromDoc = clean(documentOverride).toUpperCase();
  if ((ETA_ISSUER_TYPES as readonly string[]).includes(fromDoc)) {
    return fromDoc as IssuerType;
  }
  const fromSettings = clean(settingsType).toUpperCase();
  if ((ETA_ISSUER_TYPES as readonly string[]).includes(fromSettings)) {
    return fromSettings as IssuerType;
  }
  return 'B';
}
