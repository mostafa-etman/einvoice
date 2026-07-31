import { canonicalSerialize } from './canonical-serialize.js';
import {
  attachSignatures,
  canonicalWithoutSignatures,
  isRoundTripStable,
  parseEtaDocument,
  serializeEtaDocument,
  stripSignatures,
} from './eta-payload.js';

const doc = {
  issuer: { type: 'B', id: '720977789', name: 'Test Company' },
  documentType: 'I',
  documentTypeVersion: '1.0',
  dateTimeIssued: '2026-07-31T07:16:00Z',
  internalID: 'VAL-1',
  netAmount: 200,
};

describe('eta payload bytes', () => {
  it('serialize → parse → serialize is byte-stable', () => {
    const text = serializeEtaDocument(doc);
    expect(isRoundTripStable(text)).toBe(true);
    expect(serializeEtaDocument(parseEtaDocument(text))).toBe(text);
  });

  it('preserves field order through parse (canonical unchanged)', () => {
    const text = serializeEtaDocument(doc);
    expect(canonicalSerialize(parseEtaDocument(text))).toBe(canonicalSerialize(doc));
  });

  it('key reordering (as jsonb does) changes the canonical string', () => {
    // jsonb sorts keys by length then bytewise — this is what broke ITIDA 4043.
    const reordered = Object.fromEntries(
      Object.entries(doc).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)),
    );
    expect(Object.keys(reordered)).not.toEqual(Object.keys(doc));
    expect(canonicalSerialize(reordered)).not.toBe(canonicalSerialize(doc));
  });

  it('canonical ignores signatures so signing and sending agree', () => {
    const signed = attachSignatures(doc, [{ signatureType: 'I', value: 'AAAA' }]);
    expect(canonicalWithoutSignatures(signed)).toBe(canonicalSerialize(doc));
    expect(stripSignatures(signed)).toEqual(doc);
    expect(Object.keys(stripSignatures(signed))).toEqual(Object.keys(doc));
  });
});
