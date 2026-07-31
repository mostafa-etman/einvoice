import { createHash } from 'node:crypto';
import { canonicalWithoutSignatures } from '@einvoice/eta-core';
import {
  extractCadesMessageDigest,
  sha256Hex,
  verifySignedDigest,
} from './cades-digest';

const MESSAGE_DIGEST_OID_DER = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04,
]);

function der(tag: number, value: Buffer): Buffer {
  if (value.length < 0x80) {
    return Buffer.concat([Buffer.from([tag, value.length]), value]);
  }
  const lengthBytes: number[] = [];
  let remaining = value.length;
  while (remaining > 0) {
    lengthBytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.concat([
    Buffer.from([tag, 0x80 | lengthBytes.length, ...lengthBytes]),
    value,
  ]);
}

/** BER indefinite-length node: `tag 80 <value> 00 00` — what BouncyCastle emits. */
function berIndefinite(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, 0x80]), value, Buffer.from([0x00, 0x00])]);
}

function messageDigestAttribute(digestHex: string): Buffer {
  return der(
    0x30,
    Buffer.concat([
      MESSAGE_DIGEST_OID_DER,
      der(0x31, der(0x04, Buffer.from(digestHex, 'hex'))),
    ]),
  );
}

/** Minimal CMS-shaped DER carrying one message-digest signed attribute. */
function fakeCades(digestHex: string): string {
  const signedAttrs = der(0xa0, messageDigestAttribute(digestHex));
  return der(0x30, der(0x30, signedAttrs)).toString('base64');
}

/** Same attribute wrapped in indefinite-length constructed nodes. */
function fakeCadesIndefinite(digestHex: string): string {
  const signerInfo = berIndefinite(0x30, der(0xa0, messageDigestAttribute(digestHex)));
  const signedData = berIndefinite(0x30, berIndefinite(0x31, signerInfo));
  return berIndefinite(
    0x30,
    Buffer.concat([MESSAGE_DIGEST_OID_DER, berIndefinite(0xa0, signedData)]),
  ).toString('base64');
}

const document = {
  issuer: { type: 'B', id: '720977789' },
  documentType: 'I',
  dateTimeIssued: '2026-07-31T07:16:00Z',
  internalID: 'VAL-1',
  netAmount: 200,
};

const canonical = canonicalWithoutSignatures(document);
const digestHex = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');

describe('cades digest self-check', () => {
  it('extracts the message-digest signed attribute', () => {
    expect(extractCadesMessageDigest(fakeCades(digestHex))).toBe(digestHex);
  });

  it('extracts it from BER indefinite-length CMS (BouncyCastle output)', () => {
    expect(extractCadesMessageDigest(fakeCadesIndefinite(digestHex))).toBe(digestHex);
  });

  it('passes the self-check for an indefinite-length signature', () => {
    const result = verifySignedDigest({
      ...document,
      signatures: [{ signatureType: 'I', value: fakeCadesIndefinite(digestHex) }],
    });
    expect(result.ok).toBe(true);
  });

  it('sha256Hex hashes UTF-8 bytes of the canonical string', () => {
    expect(sha256Hex(canonical)).toBe(digestHex);
  });

  it('passes when the signature covers the outgoing bytes', () => {
    const result = verifySignedDigest({
      ...document,
      signatures: [{ signatureType: 'I', value: fakeCades(digestHex) }],
    });
    expect(result.ok).toBe(true);
  });

  it('blocks when a field was reordered after signing', () => {
    const signatures = [{ signatureType: 'I', value: fakeCades(digestHex) }];
    const reordered = {
      internalID: document.internalID,
      documentType: document.documentType,
      issuer: document.issuer,
      dateTimeIssued: document.dateTimeIssued,
      netAmount: document.netAmount,
      signatures,
    };
    const result = verifySignedDigest(reordered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('4043');
    }
  });

  it('blocks an unsigned document', () => {
    expect(verifySignedDigest({ ...document }).ok).toBe(false);
  });
});
