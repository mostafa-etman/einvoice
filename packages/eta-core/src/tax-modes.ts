/**
 * ETA T1 (VAT) subtype classifications from the seeded TaxSubtypes.json catalog.
 * Codes are never invented here — they must exist in TAX_SUBTYPE seed data.
 *
 * Zero-rated: export / free-zone supplies declared under VAT at 0%.
 * Exempt: supplies exempt from VAT (still declared as a T1 entry at rate 0).
 * "No tax" is a separate mode: taxableItems is empty (no T1 entry at all).
 */
export const ETA_VAT_TAX_TYPE = 'T1';

/** Seeded T1 subtypes that represent zero-rated (export) supplies. */
export const ETA_ZERO_RATED_SUBTYPES = ['V001', 'V002'] as const;

/**
 * Seeded T1 subtypes that represent VAT exemption / non-taxable declarations.
 * V003 = general exempt; V004 = non-taxable; V005–V008 = specific exemptions.
 */
export const ETA_EXEMPT_SUBTYPES = [
  'V003',
  'V004',
  'V005',
  'V006',
  'V007',
  'V008',
] as const;

/** Standard taxable general sales subtype (typical 14% VAT). */
export const ETA_STANDARD_TAXABLE_SUBTYPE = 'V009';

export type EtaZeroRatedSubtype = (typeof ETA_ZERO_RATED_SUBTYPES)[number];
export type EtaExemptSubtype = (typeof ETA_EXEMPT_SUBTYPES)[number];

export type LineTaxMode = 'taxable' | 'zero_rated' | 'exempt' | 'none';

export type LineTaxInputLike = {
  taxType: string;
  subType: string;
  rate: string;
};

const ZERO_SET = new Set<string>(ETA_ZERO_RATED_SUBTYPES);
const EXEMPT_SET = new Set<string>(ETA_EXEMPT_SUBTYPES);

export function isZeroRatedSubtype(code: string): boolean {
  return ZERO_SET.has(code);
}

export function isExemptSubtype(code: string): boolean {
  return EXEMPT_SET.has(code);
}

export function isZeroOrExemptSubtype(code: string): boolean {
  return isZeroRatedSubtype(code) || isExemptSubtype(code);
}

/** Default taxable row: T1 / V009 / 14% (General Item sales). */
export function defaultTaxableTax(): LineTaxInputLike {
  return {
    taxType: ETA_VAT_TAX_TYPE,
    subType: ETA_STANDARD_TAXABLE_SUBTYPE,
    rate: '14.00',
  };
}

/** Zero-rated VAT entry — rate locked at 0; subtype must be a seeded zero-rated code. */
export function zeroRatedTax(
  subType: string = ETA_ZERO_RATED_SUBTYPES[0],
): LineTaxInputLike {
  if (!isZeroRatedSubtype(subType)) {
    throw new Error(`Not a seeded zero-rated T1 subtype: ${subType}`);
  }
  return { taxType: ETA_VAT_TAX_TYPE, subType, rate: '0' };
}

/** Exempt / non-taxable VAT entry — rate locked at 0; subtype must be a seeded exempt code. */
export function exemptTax(
  subType: string = ETA_EXEMPT_SUBTYPES[0],
): LineTaxInputLike {
  if (!isExemptSubtype(subType)) {
    throw new Error(`Not a seeded exempt T1 subtype: ${subType}`);
  }
  return { taxType: ETA_VAT_TAX_TYPE, subType, rate: '0' };
}

/**
 * Infer UI tax mode from persisted taxes.
 * Empty → none; single 0% zero/exempt subtype → that mode; otherwise taxable.
 */
export function inferLineTaxMode(
  taxes: LineTaxInputLike[] | undefined | null,
): LineTaxMode {
  const list = taxes ?? [];
  if (list.length === 0) return 'none';
  if (list.length === 1) {
    const t = list[0]!;
    const rate = Number(t.rate);
    if (t.taxType === ETA_VAT_TAX_TYPE && rate === 0) {
      if (isZeroRatedSubtype(t.subType)) return 'zero_rated';
      if (isExemptSubtype(t.subType)) return 'exempt';
    }
  }
  return 'taxable';
}

/** Taxes to persist for a given mode (empty array for "no tax"). */
export function taxesForMode(
  mode: LineTaxMode,
  opts?: {
    taxes?: LineTaxInputLike[];
    zeroRatedSubtype?: string;
    exemptSubtype?: string;
  },
): LineTaxInputLike[] {
  switch (mode) {
    case 'none':
      return [];
    case 'zero_rated': {
      const sub = opts?.zeroRatedSubtype;
      return [
        zeroRatedTax(
          sub && isZeroRatedSubtype(sub) ? sub : ETA_ZERO_RATED_SUBTYPES[0],
        ),
      ];
    }
    case 'exempt': {
      const sub = opts?.exemptSubtype;
      return [
        exemptTax(sub && isExemptSubtype(sub) ? sub : ETA_EXEMPT_SUBTYPES[0]),
      ];
    }
    case 'taxable':
      return opts?.taxes?.length ? opts.taxes : [defaultTaxableTax()];
  }
}

/**
 * ETA rule: each TaxType must be unique within a single invoice line.
 * Returns duplicate taxType codes (empty if all unique).
 */
export function findDuplicateTaxTypes(
  taxes: LineTaxInputLike[] | undefined | null,
): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const t of taxes ?? []) {
    const key = t.taxType.trim();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    else seen.add(key);
  }
  return [...dupes];
}

/** Document kinds that typically declare VAT on domestic supplies. */
export function documentKindTypicallyRequiresTax(kind: string): boolean {
  return (
    kind === 'INVOICE' ||
    kind === 'CREDIT_NOTE' ||
    kind === 'DEBIT_NOTE'
  );
}

/** True when every line has an empty taxableItems / taxes list. */
export function isFullyTaxFree(
  lines: Array<{ taxes?: LineTaxInputLike[] | null }>,
): boolean {
  if (!lines.length) return true;
  return lines.every((l) => !(l.taxes?.length));
}

/** A TAX_TYPE / TAX_SUBTYPE catalog entry (subtypes carry TaxtypeReference as parentCode). */
export type EtaCodeEntryLike = {
  code: string;
  parentCode?: string | null;
};

/**
 * Order ETA codes the way a human reads them: T1, T2, T10 — not the plain
 * string order T1, T10, T2 (which made "next tax type" jump from T1 to T10).
 */
export function compareEtaCodes(a: string, b: string): number {
  const parse = (code: string) => {
    const m = /^([A-Za-z]*)(\d+)$/.exec(code);
    return m ? { prefix: m[1]!, num: Number(m[2]) } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb) {
    if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
    return pa.num - pb.num;
  }
  return a.localeCompare(b);
}

export function sortEtaCodeEntries<T extends EtaCodeEntryLike>(entries: T[]): T[] {
  return [...entries].sort((x, y) => compareEtaCodes(x.code, y.code));
}

/**
 * Subtypes belonging to a tax type. The parent link is required: a subtype with
 * no parentCode is never offered under an arbitrary tax type.
 */
export function subtypesForTaxType<T extends EtaCodeEntryLike>(
  subtypes: T[],
  taxType: string,
): T[] {
  return sortEtaCodeEntries(subtypes.filter((s) => s.parentCode === taxType));
}

export function firstSubtypeForTaxType(
  subtypes: EtaCodeEntryLike[],
  taxType: string,
): string {
  return subtypesForTaxType(subtypes, taxType)[0]?.code ?? '';
}

/** True when subType is a seeded child of taxType (catalog empty ⇒ cannot judge). */
export function isSubtypeOfTaxType(
  subtypes: EtaCodeEntryLike[],
  taxType: string,
  subType: string,
): boolean {
  if (!subtypes.length) return true;
  return subtypesForTaxType(subtypes, taxType).some((s) => s.code === subType);
}

/** The next tax type not yet used on a line, in natural code order. */
export function nextUnusedTaxType(
  taxTypes: EtaCodeEntryLike[],
  used: Iterable<string>,
): string | null {
  const usedSet = new Set(used);
  return (
    sortEtaCodeEntries(taxTypes).find((tt) => !usedSet.has(tt.code))?.code ?? null
  );
}
