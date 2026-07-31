/**
 * FR-004a/b/c/d — Apply ETA HTTP 202 accepted/rejected arrays to pre-created
 * SubmissionDocument rows by joining ONLY on (tenantId, internalId).
 * Never join by array index or documentId.
 */

export type EtaAcceptedDocument = {
  uuid: string;
  longId: string;
  internalId: string;
};

export type EtaRejectedDocument = {
  internalId: string;
  error: {
    code?: string;
    message?: string;
    target?: string;
    details?: unknown;
  };
};

export type Eta202Body = {
  submissionUUID: string;
  acceptedDocuments?: EtaAcceptedDocument[];
  rejectedDocuments?: EtaRejectedDocument[];
};

export type SubmissionDocumentRow = {
  id: string;
  tenantId: string;
  documentId: string;
  documentVersion: number;
  internalId: string;
  /** Current local document status before apply (must be SIGNED for refuse path). */
  documentStatus: string;
};

export type MappedDocResult =
  | {
      kind: 'accepted';
      attemptOutcome: 'ACCEPTED';
      submissionDocumentId: string;
      documentId: string;
      documentVersion: number;
      internalId: string;
      etaUuid: string;
      etaLongId: string;
      /** Document local status after apply */
      documentStatus: 'SUBMITTED';
      createFilingLock: true;
      enqueuePoll: true;
    }
  | {
      kind: 'refused';
      attemptOutcome: 'REFUSED_AT_INTAKE';
      submissionDocumentId: string;
      documentId: string;
      documentVersion: number;
      internalId: string;
      etaUuid: null;
      etaLongId: null;
      intakeErrorJson: EtaRejectedDocument['error'];
      documentStatus: 'SIGNED';
      createFilingLock: false;
      enqueuePoll: false;
    };

export type Apply202Result = {
  etaSubmissionUuid: string;
  submissionState: 'PARTIALLY_ACCEPTED' | 'SENT' | 'RESOLVED' | 'NEEDS_ATTENTION';
  acceptedCount: number;
  refusedCount: number;
  mapped: MappedDocResult[];
  /** Docs to enqueue poll for — ACCEPTED only (FR-008e) */
  pollDocumentIds: string[];
  /** Filing locks to create — ACCEPTED only (FR-004b) */
  filingLocks: Array<{
    tenantId: string;
    documentId: string;
    documentVersion: number;
    submissionDocumentId: string;
  }>;
  unmatchedAcceptedInternalIds: string[];
  unmatchedRejectedInternalIds: string[];
  missingFromBothArrays: string[];
  needsAttention: boolean;
  needsAttentionReasons: string[];
};

function normalizeInternalId(id: string): string {
  return id.trim();
}

/**
 * Apply a 202 body to pre-created batch rows.
 * Join key: tenant-scoped internalId only (FR-004a).
 */
export function apply202ResultMap(
  tenantId: string,
  rows: SubmissionDocumentRow[],
  body: Eta202Body,
): Apply202Result {
  const byInternalId = new Map<string, SubmissionDocumentRow>();
  for (const row of rows) {
    if (row.tenantId !== tenantId) {
      throw new Error(
        `SubmissionDocument tenant mismatch: expected ${tenantId}, got ${row.tenantId}`,
      );
    }
    const key = normalizeInternalId(row.internalId);
    if (byInternalId.has(key)) {
      throw new Error(`Duplicate SubmissionDocument.internalId in batch: ${key}`);
    }
    byInternalId.set(key, row);
  }

  const accepted = body.acceptedDocuments ?? [];
  const rejected = body.rejectedDocuments ?? [];
  const seen = new Set<string>();
  const mapped: MappedDocResult[] = [];
  const unmatchedAcceptedInternalIds: string[] = [];
  const unmatchedRejectedInternalIds: string[] = [];
  const needsAttentionReasons: string[] = [];

  for (const a of accepted) {
    const key = normalizeInternalId(a.internalId);
    const row = byInternalId.get(key);
    if (!row) {
      unmatchedAcceptedInternalIds.push(key);
      needsAttentionReasons.push(`Unknown accepted internalId: ${key}`);
      continue;
    }
    seen.add(key);
    mapped.push({
      kind: 'accepted',
      attemptOutcome: 'ACCEPTED',
      submissionDocumentId: row.id,
      documentId: row.documentId,
      documentVersion: row.documentVersion,
      internalId: row.internalId,
      etaUuid: a.uuid,
      etaLongId: a.longId,
      documentStatus: 'SUBMITTED',
      createFilingLock: true,
      enqueuePoll: true,
    });
  }

  for (const r of rejected) {
    const key = normalizeInternalId(r.internalId);
    const row = byInternalId.get(key);
    if (!row) {
      unmatchedRejectedInternalIds.push(key);
      needsAttentionReasons.push(`Unknown rejected internalId: ${key}`);
      continue;
    }
    seen.add(key);
    mapped.push({
      kind: 'refused',
      attemptOutcome: 'REFUSED_AT_INTAKE',
      submissionDocumentId: row.id,
      documentId: row.documentId,
      documentVersion: row.documentVersion,
      internalId: row.internalId,
      etaUuid: null,
      etaLongId: null,
      intakeErrorJson: r.error ?? { code: 'Unknown', message: 'Rejected at intake' },
      documentStatus: 'SIGNED',
      createFilingLock: false,
      enqueuePoll: false,
    });
  }

  const missingFromBothArrays: string[] = [];
  for (const [key, row] of byInternalId) {
    if (!seen.has(key)) {
      missingFromBothArrays.push(row.internalId);
      needsAttentionReasons.push(
        `Batched document missing from both accepted and rejected arrays: ${row.internalId}`,
      );
    }
  }

  const acceptedCount = mapped.filter((m) => m.kind === 'accepted').length;
  const refusedCount = mapped.filter((m) => m.kind === 'refused').length;
  const needsAttention =
    unmatchedAcceptedInternalIds.length > 0 ||
    unmatchedRejectedInternalIds.length > 0 ||
    missingFromBothArrays.length > 0;

  let submissionState: Apply202Result['submissionState'];
  if (acceptedCount > 0 && refusedCount > 0) {
    submissionState = 'PARTIALLY_ACCEPTED';
  } else if (acceptedCount > 0 && refusedCount === 0 && !needsAttention) {
    submissionState = 'SENT';
  } else if (acceptedCount === 0 && refusedCount > 0 && !needsAttention) {
    submissionState = 'RESOLVED';
  } else {
    submissionState = needsAttention ? 'NEEDS_ATTENTION' : 'RESOLVED';
  }

  const pollDocumentIds = mapped
    .filter((m) => m.kind === 'accepted')
    .map((m) => m.documentId);

  const filingLocks = mapped
    .filter((m): m is Extract<MappedDocResult, { kind: 'accepted' }> => m.kind === 'accepted')
    .map((m) => ({
      tenantId,
      documentId: m.documentId,
      documentVersion: m.documentVersion,
      submissionDocumentId: m.submissionDocumentId,
    }));

  return {
    etaSubmissionUuid: body.submissionUUID,
    submissionState,
    acceptedCount,
    refusedCount,
    mapped,
    pollDocumentIds,
    filingLocks,
    unmatchedAcceptedInternalIds,
    unmatchedRejectedInternalIds,
    missingFromBothArrays,
    needsAttention,
    needsAttentionReasons,
  };
}
