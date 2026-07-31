/**
 * FR-008-integrity: before POST, every payload documents[].internalID must
 * equal our DB Document.internalId. On any mismatch, abort the whole batch.
 *
 * Also catch ETA PatternMismatch / NumberExpected locally before POST.
 */

import { isValidEtaDateTimeIssued } from '@einvoice/eta-core';

export type PayloadDocument = {
  internalID?: unknown;
  [key: string]: unknown;
};

export type DbDocumentForIntegrity = {
  id: string;
  internalId: string;
};

export type IntegrityOk = { ok: true; documents: PayloadDocument[] };

export type IntegrityFail = {
  ok: false;
  code: 'INTERNAL_ID_MISMATCH' | 'ETA_PAYLOAD_FORMAT';
  mismatches: Array<{
    documentId: string;
    dbInternalId: string;
    payloadInternalId: string | null;
  }>;
  reason: string;
};

export type IntegrityResult = IntegrityOk | IntegrityFail;

/**
 * Build the documents array that will be POSTed and verify internalID equality.
 * Returns fail if any mismatch — caller MUST abort and mark needsAttention.
 */
export function verifyPayloadInternalIds(
  dbDocs: DbDocumentForIntegrity[],
  payloadsByDocumentId: Map<string, PayloadDocument>,
): IntegrityResult {
  const mismatches: IntegrityFail['mismatches'] = [];
  const documents: PayloadDocument[] = [];

  for (const db of dbDocs) {
    const payload = payloadsByDocumentId.get(db.id);
    if (!payload) {
      mismatches.push({
        documentId: db.id,
        dbInternalId: db.internalId,
        payloadInternalId: null,
      });
      continue;
    }

    const raw = payload.internalID ?? payload.internalId;
    const payloadInternalId =
      typeof raw === 'string' ? raw.trim() : raw == null ? null : String(raw).trim();

    // Mutate a shallow copy so we never alter stored etaPayloadJson in place.
    const outbound: PayloadDocument = { ...payload, internalID: db.internalId };

    if (payloadInternalId !== db.internalId) {
      mismatches.push({
        documentId: db.id,
        dbInternalId: db.internalId,
        payloadInternalId,
      });
    }

    documents.push(outbound);
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      code: 'INTERNAL_ID_MISMATCH',
      mismatches,
      reason:
        'One or more documents[].internalID values do not match DB Document.internalId; ' +
        'submission aborted before POST (FR-008-integrity).',
    };
  }

  return { ok: true, documents };
}

const DOC_NUMBER_FIELDS = [
  'totalSalesAmount',
  'totalDiscountAmount',
  'netAmount',
  'totalAmount',
  'extraDiscountAmount',
  'totalItemsDiscountAmount',
] as const;

/**
 * Local gate for ETA intake schema rules we already know cause REFUSED_AT_INTAKE:
 * dateTimeIssued pattern (no ms) and Decimal fields as JSON numbers.
 */
export function verifyEtaPayloadFormats(
  documents: PayloadDocument[],
): IntegrityResult {
  const problems: string[] = [];

  for (const doc of documents) {
    const id = typeof doc.internalID === 'string' ? doc.internalID : '?';
    if (!isValidEtaDateTimeIssued(doc.dateTimeIssued)) {
      problems.push(
        `${id}: dateTimeIssued must match yyyy-MM-ddTHH:mm:ssZ (got ${JSON.stringify(doc.dateTimeIssued)})`,
      );
    }
    for (const field of DOC_NUMBER_FIELDS) {
      const v = doc[field];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
        problems.push(
          `${id}: ${field} must be a JSON number (got ${typeof v} ${JSON.stringify(v)})`,
        );
      }
    }
  }

  if (problems.length === 0) {
    return { ok: true, documents };
  }

  return {
    ok: false,
    code: 'ETA_PAYLOAD_FORMAT',
    mismatches: [],
    reason:
      'ETA payload format invalid (would cause PatternMismatch/NumberExpected); ' +
      'submission aborted before POST. ' +
      problems.join('; '),
  };
}
