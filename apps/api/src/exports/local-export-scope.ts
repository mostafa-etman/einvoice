/**
 * Maps the existing LocalExportFilters.documentTypes list onto issued (sales)
 * vs received (purchases) tables. Unknown values are ignored so they cannot
 * widen the export beyond the selected scope.
 */

export const ISSUED_DOCUMENT_TYPES = [
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'EXPORT_INVOICE',
  'EXPORT_CREDIT_NOTE',
  'EXPORT_DEBIT_NOTE',
] as const;

export const RECEIVED_DOCUMENT_TYPES = [
  'PURCHASE_INVOICE',
  'PURCHASE_RETURN',
  'OTHER_RECEIVED',
] as const;

const ISSUED = new Set<string>(ISSUED_DOCUMENT_TYPES);
const RECEIVED = new Set<string>(RECEIVED_DOCUMENT_TYPES);

export type LocalExportKindScope = {
  /** `all` = no kind predicate (legacy omit-documentTypes behaviour). */
  issuedKinds: 'all' | 'none' | string[];
  receivedKinds: 'all' | 'none' | string[];
};

const SCOPE_ALIASES: Record<string, LocalExportKindScope> = {
  ALL: { issuedKinds: 'all', receivedKinds: 'all' },
  SALES: { issuedKinds: 'all', receivedKinds: 'none' },
  PURCHASES: { issuedKinds: 'none', receivedKinds: 'all' },
};

/**
 * Existing contract: omitting documentTypes means every issued/sales document.
 * Passing purchase kinds (or a mix) is how the UI selects Purchases / All
 * without a new API field. A single All/Sales/Purchases alias is accepted so a
 * mis-sent scope label cannot silently match zero rows.
 */
export function splitLocalExportDocumentTypes(
  documentTypes?: string[] | null,
): LocalExportKindScope {
  if (!Array.isArray(documentTypes) || !documentTypes.length) {
    return { issuedKinds: 'all', receivedKinds: 'none' };
  }
  if (documentTypes.length === 1) {
    const alias = SCOPE_ALIASES[String(documentTypes[0]).trim().toUpperCase()];
    if (alias) return alias;
  }
  const issued = [
    ...new Set(documentTypes.filter((k) => ISSUED.has(String(k)))),
  ];
  const received = [
    ...new Set(documentTypes.filter((k) => RECEIVED.has(String(k)))),
  ];
  return {
    issuedKinds: issued.length ? issued : 'none',
    receivedKinds: received.length ? received : 'none',
  };
}
