/**
 * Received-document direction + type classification for Purchases.
 * ETA Search/Recent must always filter with this direction value.
 */
export const ETA_DOCUMENT_DIRECTION_RECEIVED = 'Received' as const;

export type EtaDocumentDirectionReceived =
  typeof ETA_DOCUMENT_DIRECTION_RECEIVED;

export type ReceivedDocumentKind =
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_RETURN'
  | 'OTHER_RECEIVED';

/**
 * Map ETA document type codes to purchase classification.
 * Domestic Invoice (`I`) → purchase invoice; Credit Note (`C`) → purchase return.
 * Debit / export / unknown → OTHER_RECEIVED (not default Purchases list).
 */
export function classifyReceivedDocument(
  etaDocumentType: string | null | undefined,
): ReceivedDocumentKind {
  const code = String(etaDocumentType ?? '')
    .trim()
    .toUpperCase();
  if (code === 'I') return 'PURCHASE_INVOICE';
  if (code === 'C') return 'PURCHASE_RETURN';
  return 'OTHER_RECEIVED';
}

/** Build query params that always force received direction (never Issued). */
export function receivedDirectionQuery(
  extra?: Record<string, string | number | undefined | null>,
): Record<string, string> {
  const out: Record<string, string> = {
    direction: ETA_DOCUMENT_DIRECTION_RECEIVED,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null || k === 'direction') continue;
      out[k] = String(v);
    }
  }
  return out;
}

/** Guard: reject accidental Issued / missing direction before calling ETA. */
export function assertReceivedDirection(
  params: Record<string, string | undefined>,
): void {
  const d = params.direction;
  if (d !== ETA_DOCUMENT_DIRECTION_RECEIVED) {
    throw new Error(
      `Purchases sync requires direction=${ETA_DOCUMENT_DIRECTION_RECEIVED}, got ${d ?? '(missing)'}`,
    );
  }
}
