import { apply202ResultMap } from '../src/submissions/submission-202-result-map';

/**
 * T017a — mixed 202 result map (analyze I1–I8).
 *
 * CRITICAL: accepted/rejected arrays MUST be in a DIFFERENT order than the
 * input batch so a join-by-index bug cannot pass this test.
 *
 * Input batch order: [A, B, C]
 * Mocked 202: accepted:[C, A], rejected:[B]
 */
describe('submission 202 result map (T017a)', () => {
  const tenantId = 'tenant-1';

  const rows = [
    {
      id: 'sd-a',
      tenantId,
      documentId: 'doc-a',
      documentVersion: 1,
      internalId: 'A',
      documentStatus: 'SIGNED',
    },
    {
      id: 'sd-b',
      tenantId,
      documentId: 'doc-b',
      documentVersion: 1,
      internalId: 'B',
      documentStatus: 'SIGNED',
    },
    {
      id: 'sd-c',
      tenantId,
      documentId: 'doc-c',
      documentVersion: 1,
      internalId: 'C',
      documentStatus: 'SIGNED',
    },
  ];

  /** Shuffled relative to input [A,B,C] — proves FR-004a join-by-internalId. */
  const body = {
    submissionUUID: 'sub-uuid-xyz',
    acceptedDocuments: [
      { uuid: 'uuid-c', longId: 'long-c', internalId: 'C' },
      { uuid: 'uuid-a', longId: 'long-a', internalId: 'A' },
    ],
    rejectedDocuments: [
      {
        internalId: 'B',
        error: { code: 'ValidationError', message: 'Bad buyer id', target: 'B' },
      },
    ],
  };

  it('joins by internalId only — shuffled response does not mis-attribute uuids', () => {
    // Sanity: response order ≠ input order
    expect(body.acceptedDocuments.map((d) => d.internalId)).toEqual(['C', 'A']);
    expect(rows.map((r) => r.internalId)).toEqual(['A', 'B', 'C']);

    const result = apply202ResultMap(tenantId, rows, body);

    const byInternal = Object.fromEntries(result.mapped.map((m) => [m.internalId, m]));

    expect(byInternal.A.kind).toBe('accepted');
    expect(byInternal.A.etaUuid).toBe('uuid-a');
    expect(byInternal.A.etaLongId).toBe('long-a');
    expect(byInternal.A.documentStatus).toBe('SUBMITTED');
    expect(byInternal.A.createFilingLock).toBe(true);

    expect(byInternal.C.kind).toBe('accepted');
    expect(byInternal.C.etaUuid).toBe('uuid-c');
    expect(byInternal.C.etaLongId).toBe('long-c');

    // If joined by index, A would get uuid-c (first accepted) — must not.
    expect(byInternal.A.etaUuid).not.toBe('uuid-c');
    expect(byInternal.C.etaUuid).not.toBe('uuid-a');
  });

  it('refused stays SIGNED with intakeErrorJson, no lock, no poll', () => {
    const result = apply202ResultMap(tenantId, rows, body);
    const refused = result.mapped.find((m) => m.internalId === 'B');
    expect(refused).toMatchObject({
      kind: 'refused',
      attemptOutcome: 'REFUSED_AT_INTAKE',
      etaUuid: null,
      etaLongId: null,
      documentStatus: 'SIGNED',
      createFilingLock: false,
      enqueuePoll: false,
    });
    expect(refused && refused.kind === 'refused' && refused.intakeErrorJson.code).toBe(
      'ValidationError',
    );
  });

  it('sets PARTIALLY_ACCEPTED; locks and poll only for accepted', () => {
    const result = apply202ResultMap(tenantId, rows, body);

    expect(result.submissionState).toBe('PARTIALLY_ACCEPTED');
    expect(result.acceptedCount).toBe(2);
    expect(result.refusedCount).toBe(1);
    expect(result.etaSubmissionUuid).toBe('sub-uuid-xyz');

    expect(result.filingLocks).toHaveLength(2);
    expect(result.filingLocks.map((l) => l.documentId).sort()).toEqual(['doc-a', 'doc-c']);
    expect(result.filingLocks.every((l) => l.tenantId === tenantId)).toBe(true);
    // No lock for refused B
    expect(result.filingLocks.find((l) => l.documentId === 'doc-b')).toBeUndefined();

    expect(result.pollDocumentIds.sort()).toEqual(['doc-a', 'doc-c']);
    expect(result.pollDocumentIds).not.toContain('doc-b');
  });

  it('flags needsAttention for unknown accepted internalId without inventing rows', () => {
    const result = apply202ResultMap(tenantId, rows, {
      submissionUUID: 'x',
      acceptedDocuments: [
        { uuid: 'u', longId: 'l', internalId: 'UNKNOWN' },
        { uuid: 'uuid-a', longId: 'long-a', internalId: 'A' },
      ],
      rejectedDocuments: [],
    });
    expect(result.needsAttention).toBe(true);
    expect(result.unmatchedAcceptedInternalIds).toContain('UNKNOWN');
    expect(result.mapped.filter((m) => m.kind === 'accepted')).toHaveLength(1);
  });
});
