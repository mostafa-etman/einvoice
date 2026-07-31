import { assembleSubmitDocuments } from '../src/submissions/batch-assembler';
import { verifyPayloadInternalIds } from '../src/submissions/submission-integrity';

/**
 * T013 — signed-byte + internalID integrity (FR-008-integrity).
 * Mismatch aborts the whole submission before POST.
 */
describe('submission payload integrity (T013)', () => {
  it('assembles documents as exact stored etaPayloadJson references (no re-canonicalize)', () => {
    const payloadA = {
      internalID: 'INV-A',
      signatures: [{ value: 'sig-a' }],
      marker: 'byte-equal-a',
    };
    const payloadB = {
      internalID: 'INV-B',
      signatures: [{ value: 'sig-b' }],
      marker: 'byte-equal-b',
    };

    const { documents } = assembleSubmitDocuments([
      { id: 'doc-a', internalId: 'INV-A', etaPayloadJson: payloadA },
      { id: 'doc-b', internalId: 'INV-B', etaPayloadJson: payloadB },
    ]);

    expect(documents).toHaveLength(2);
    expect(documents[0]).toBe(payloadA);
    expect(documents[1]).toBe(payloadB);
    expect(JSON.stringify(documents[0])).toBe(JSON.stringify(payloadA));
  });

  it('passes when every documents[].internalID matches DB Document.internalId', () => {
    const payloadA = { internalID: 'INV-A', body: 1 };
    const payloadB = { internalID: 'INV-B', body: 2 };
    const { payloadsByDocumentId } = assembleSubmitDocuments([
      { id: 'doc-a', internalId: 'INV-A', etaPayloadJson: payloadA },
      { id: 'doc-b', internalId: 'INV-B', etaPayloadJson: payloadB },
    ]);

    const result = verifyPayloadInternalIds(
      [
        { id: 'doc-a', internalId: 'INV-A' },
        { id: 'doc-b', internalId: 'INV-B' },
      ],
      payloadsByDocumentId,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.internalID)).toEqual(['INV-A', 'INV-B']);
    }
  });

  it('ABORTS whole submission on any internalID mismatch (FR-008-integrity)', () => {
    const payloadA = { internalID: 'INV-A', body: 1 };
    // Stored payload has wrong internalID vs DB — must abort entire batch
    const payloadB = { internalID: 'WRONG-B', body: 2 };
    const { payloadsByDocumentId } = assembleSubmitDocuments([
      { id: 'doc-a', internalId: 'INV-A', etaPayloadJson: payloadA },
      { id: 'doc-b', internalId: 'INV-B', etaPayloadJson: payloadB },
    ]);

    const result = verifyPayloadInternalIds(
      [
        { id: 'doc-a', internalId: 'INV-A' },
        { id: 'doc-b', internalId: 'INV-B' },
      ],
      payloadsByDocumentId,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INTERNAL_ID_MISMATCH');
      expect(result.mismatches).toEqual([
        {
          documentId: 'doc-b',
          dbInternalId: 'INV-B',
          payloadInternalId: 'WRONG-B',
        },
      ]);
      expect(result.reason).toMatch(/aborted before POST/i);
    }
  });

  it('does not POST a batch that contains a mismatched internalId', () => {
    let posted = false;
    const postBatch = (integrityOk: boolean) => {
      if (!integrityOk) {
        // FR-008-integrity: abort — mark needsAttention + audit (caller responsibility)
        return { aborted: true as const, needsAttention: true as const };
      }
      posted = true;
      return { aborted: false as const };
    };

    const { payloadsByDocumentId } = assembleSubmitDocuments([
      {
        id: 'doc-1',
        internalId: 'X',
        etaPayloadJson: { internalID: 'Y' },
      },
    ]);
    const integrity = verifyPayloadInternalIds(
      [{ id: 'doc-1', internalId: 'X' }],
      payloadsByDocumentId,
    );

    const outcome = postBatch(integrity.ok);
    expect(outcome.aborted).toBe(true);
    expect(outcome.needsAttention).toBe(true);
    expect(posted).toBe(false);
  });
});
