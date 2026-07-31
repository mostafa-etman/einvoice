/**
 * FR-008: assemble submit body from stored signed payloads — no re-canonicalize.
 * Pair with verifyPayloadInternalIds before POST.
 */

export type StoredSignedDocument = {
  id: string;
  internalId: string;
  /** Exact signed ETA document object (etaPayloadJson + signatures as stored). */
  etaPayloadJson: Record<string, unknown>;
};

/**
 * Build `{ documents }` for ETA POST from DB rows in caller-chosen order.
 * Returns the same object references from storage — never re-serializes.
 */
export function assembleSubmitDocuments(docs: StoredSignedDocument[]): {
  documents: Record<string, unknown>[];
  payloadsByDocumentId: Map<string, Record<string, unknown>>;
} {
  const documents: Record<string, unknown>[] = [];
  const payloadsByDocumentId = new Map<string, Record<string, unknown>>();

  for (const doc of docs) {
    // Intentionally no JSON.parse(JSON.stringify) / re-canonicalize.
    documents.push(doc.etaPayloadJson);
    payloadsByDocumentId.set(doc.id, doc.etaPayloadJson);
  }

  return { documents, payloadsByDocumentId };
}
