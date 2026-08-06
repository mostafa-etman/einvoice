import {
  extractEtaDocumentStatus,
} from './eta-submission-status.client';

describe('extractEtaDocumentStatus', () => {
  it('reads common ETA status fields', () => {
    expect(extractEtaDocumentStatus({ status: 'Valid' })).toBe('Valid');
    expect(extractEtaDocumentStatus({ Status: 'Invalid' })).toBe('Invalid');
    expect(
      extractEtaDocumentStatus({ document: { status: 'Submitted' } }),
    ).toBe('Submitted');
  });

  it('returns null when missing', () => {
    expect(extractEtaDocumentStatus({})).toBeNull();
    expect(extractEtaDocumentStatus(null)).toBeNull();
  });
});
