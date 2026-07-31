import { buildSignedEtaPayload } from './signed-payload';

describe('buildSignedEtaPayload', () => {
  it('merges signatures without mutating the stored payload object', () => {
    const stored = { internalID: 'VAL-1', documentType: 'I' };
    const out = buildSignedEtaPayload(stored, [
      { signatureType: 'I', value: 'abc' },
    ]);
    expect(out.signatures).toEqual([{ signatureType: 'I', value: 'abc' }]);
    expect(stored).not.toHaveProperty('signatures');
    expect(out.internalID).toBe('VAL-1');
  });
});
