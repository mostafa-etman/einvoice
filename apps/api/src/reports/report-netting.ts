import type { DocumentKind, ReceivedDocumentKind } from '@prisma/client';

/** Credit notes reduce; invoices and debit notes increase. */
export function issuedDocumentSign(kind: DocumentKind | string): 1 | -1 {
  switch (kind) {
    case 'CREDIT_NOTE':
    case 'EXPORT_CREDIT_NOTE':
      return -1;
    default:
      return 1;
  }
}

export function receivedDocumentSign(
  kind: ReceivedDocumentKind | string,
  etaDocumentType?: string | null,
): 1 | -1 {
  if (kind === 'PURCHASE_RETURN') return -1;
  if (kind === 'PURCHASE_INVOICE') return 1;
  const t = (etaDocumentType ?? '').trim().toUpperCase();
  if (t === 'C' || t === 'EC') return -1;
  return 1;
}

export function isCreditLikeIssued(kind: DocumentKind | string): boolean {
  return issuedDocumentSign(kind) === -1;
}

export function isCreditLikeReceived(
  kind: ReceivedDocumentKind | string,
  etaDocumentType?: string | null,
): boolean {
  return receivedDocumentSign(kind, etaDocumentType) === -1;
}
