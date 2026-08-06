/**
 * ETA internalID rules.
 *
 * Official Invoice v1.0 documents `internalId` as a submitter-defined String
 * (examples: AZ-24883, PZ-234-A). No published regex; we enforce a conservative
 * Latin charset + length so values stay safe for JSON, signing, and ERP mapping.
 */

/** Max length aligned with other ETA string fields (e.g. proformaInvoiceNumber). */
export const ETA_INTERNAL_ID_MAX_LENGTH = 50;

/**
 * Latin letters, digits, and separators used in ETA examples (hyphen, underscore, dot).
 * Must start with alphanumeric (avoids leading separators / empty-looking IDs).
 */
export const ETA_INTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;

export type InternalIdSchemeInput = {
  prefix: string;
  padWidth: number;
  /** First number that will be issued (inclusive). */
  startingNumber: number;
  /**
   * NUMERIC — sequence portion is decimal digits only.
   * ALPHANUMERIC — same numeric counter today; prefix may use the full charset
   * (reserved for future non-decimal counters).
   */
  charset: 'NUMERIC' | 'ALPHANUMERIC';
};

export type InternalIdSchemeIssue = {
  code: string;
  message: string;
};

export function isValidEtaInternalId(value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (!v || v.length > ETA_INTERNAL_ID_MAX_LENGTH) return false;
  return ETA_INTERNAL_ID_PATTERN.test(v);
}

export function formatInternalId(
  prefix: string,
  sequenceNumber: number,
  padWidth: number,
): string {
  const n = Math.max(0, Math.floor(sequenceNumber));
  const width = Math.max(1, Math.min(12, Math.floor(padWidth)));
  const body = String(n).padStart(width, '0');
  return `${prefix}${body}`;
}

/**
 * Validate a tenant numbering scheme would only produce ETA-safe internalIds.
 * Does not allocate a number — checks prefix charset, pad bounds, and max length
 * for startingNumber and a high watermark (pad overflow).
 */
export function validateInternalIdScheme(
  input: InternalIdSchemeInput,
): InternalIdSchemeIssue[] {
  const issues: InternalIdSchemeIssue[] = [];
  const prefix = input.prefix ?? '';
  const padWidth = Number(input.padWidth);
  const startingNumber = Number(input.startingNumber);

  if (!Number.isFinite(padWidth) || padWidth < 1 || padWidth > 12) {
    issues.push({
      code: 'PAD_WIDTH_INVALID',
      message: 'Number padding width must be between 1 and 12',
    });
  }
  if (
    !Number.isFinite(startingNumber) ||
    startingNumber < 0 ||
    !Number.isInteger(startingNumber)
  ) {
    issues.push({
      code: 'STARTING_NUMBER_INVALID',
      message: 'Starting number must be a non-negative integer',
    });
  }
  if (prefix.length > 30) {
    issues.push({
      code: 'PREFIX_TOO_LONG',
      message: 'Prefix must be at most 30 characters',
    });
  }
  // Empty prefix is allowed (pure numeric IDs) if the result still matches.
  if (prefix && !/^[A-Za-z0-9._-]*$/.test(prefix)) {
    issues.push({
      code: 'PREFIX_CHARSET',
      message:
        'Prefix may only contain Latin letters, digits, hyphen, underscore, and dot',
    });
  }
  if (prefix && input.charset === 'NUMERIC' && /[A-Za-z]/.test(prefix) === false) {
    // numeric charset still allows letter prefixes (INV-); no issue
  }
  if (prefix && !/^[A-Za-z0-9]/.test(prefix) && prefix.length > 0) {
    issues.push({
      code: 'PREFIX_START',
      message: 'Prefix must start with a Latin letter or digit',
    });
  }

  if (issues.length) return issues;

  const sample = formatInternalId(prefix, startingNumber || 1, padWidth);
  if (!isValidEtaInternalId(sample)) {
    issues.push({
      code: 'SCHEME_PRODUCES_INVALID',
      message: `Scheme would produce invalid internalId "${sample}" (ETA allows Latin alphanumeric with ._- , max ${ETA_INTERNAL_ID_MAX_LENGTH})`,
    });
  }

  // Worst case at pad boundary (e.g. 999999 for width 6) must still fit.
  const maxAtWidth = Math.pow(10, padWidth) - 1;
  const atCeiling = formatInternalId(prefix, maxAtWidth, padWidth);
  if (!isValidEtaInternalId(atCeiling)) {
    issues.push({
      code: 'SCHEME_TOO_LONG',
      message: `Prefix + padded number exceeds ETA max length ${ETA_INTERNAL_ID_MAX_LENGTH} (example: ${atCeiling})`,
    });
  }

  return issues;
}

/** ETA document UUID is 26 Latin alphanumeric; longId is 42. */
export const ETA_DOCUMENT_UUID_PATTERN = /^[A-Za-z0-9]{26}$/;
export const ETA_DOCUMENT_LONG_ID_PATTERN = /^[A-Za-z0-9]{42}$/;

/**
 * Soft check for credit/debit reference values. Accepts ETA uuid, longId, or
 * a conservative alphanumeric token (legacy / external systems).
 */
export function isPlausibleEtaDocumentReference(
  value: string | null | undefined,
): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (!v) return false;
  if (ETA_DOCUMENT_UUID_PATTERN.test(v)) return true;
  if (ETA_DOCUMENT_LONG_ID_PATTERN.test(v)) return true;
  // Allow external/legacy ids that aren't exact ETA shapes but are printable.
  return /^[A-Za-z0-9._-]{8,50}$/.test(v);
}
