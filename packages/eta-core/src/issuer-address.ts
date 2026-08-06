/**
 * Issuer address resolution.
 *
 * The issuer is the seller — our own company — so its address belongs to
 * tenant/branch settings, not to each invoice. Documents inherit the branch
 * address and may only override individual fields; a blank override never
 * wins over settings, otherwise every invoice would silently ship an
 * incomplete issuer address to ETA.
 */

export type IssuerAddress = {
  branchId?: string;
  country?: string;
  governate?: string;
  regionCity?: string;
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

/** ETA rejects an issuer address without these; `branchId`/`country` default. */
export const REQUIRED_ISSUER_ADDRESS_FIELDS = [
  'governate',
  'regionCity',
  'street',
  'buildingNumber',
] as const satisfies readonly (keyof IssuerAddress)[];

export const ISSUER_ADDRESS_FIELDS = [
  'branchId',
  'country',
  'governate',
  'regionCity',
  'street',
  'buildingNumber',
  'postalCode',
  'floor',
  'room',
  'landmark',
  'additionalInformation',
] as const satisfies readonly (keyof IssuerAddress)[];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Drops blank fields so spreading an override cannot erase a settings value. */
export function normalizeIssuerAddress(
  address: IssuerAddress | null | undefined,
): IssuerAddress {
  const out: IssuerAddress = {};
  if (!address) return out;
  for (const field of ISSUER_ADDRESS_FIELDS) {
    const value = clean(address[field]);
    if (value) out[field] = value;
  }
  return out;
}

/**
 * Merge the branch (settings) address with per-document overrides.
 * Blank overrides fall back to settings; `branchId`/`country` always resolve.
 */
export function resolveIssuerAddress(
  settingsAddress: IssuerAddress | null | undefined,
  documentOverrides?: IssuerAddress | null,
  defaults?: { branchId?: string | null; country?: string | null },
): IssuerAddress {
  const merged: IssuerAddress = {
    ...normalizeIssuerAddress(settingsAddress),
    ...normalizeIssuerAddress(documentOverrides),
  };
  if (!merged.branchId) {
    merged.branchId = clean(defaults?.branchId) || '0';
  }
  if (!merged.country) {
    merged.country = clean(defaults?.country) || 'EG';
  }
  return merged;
}

/** Required fields still blank — empty array means the address is complete. */
export function missingIssuerAddressFields(
  address: IssuerAddress | null | undefined,
): Array<(typeof REQUIRED_ISSUER_ADDRESS_FIELDS)[number]> {
  const normalized = normalizeIssuerAddress(address);
  return REQUIRED_ISSUER_ADDRESS_FIELDS.filter((field) => !normalized[field]);
}

export function isIssuerAddressComplete(
  address: IssuerAddress | null | undefined,
): boolean {
  return missingIssuerAddressFields(address).length === 0;
}
