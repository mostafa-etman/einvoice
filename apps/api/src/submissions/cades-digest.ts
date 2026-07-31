/**
 * Pre-submit proof that WHAT WE SIGNED === WHAT WE SEND.
 *
 * The CAdES-BES signed attributes carry `message-digest`, the SHA-256 of the
 * canonical string the token actually signed. Recomputing that digest from the
 * outgoing document must reproduce it exactly; if it does not, the document is
 * doomed at ETA's ITIDA signature step (4043) and must not be submitted.
 */

import { createHash } from 'node:crypto';
import { canonicalWithoutSignatures, type JsonObject } from '@einvoice/eta-core';

const MESSAGE_DIGEST_OID = '1.2.840.113549.1.9.4';
const TAG_OID = 0x06;
const TAG_OCTET_STRING = 0x04;

const TAG_EOC = 0x00;

type Tlv = {
  tag: number;
  headerEnd: number;
  valueEnd: number;
  /** BER indefinite length: the value ends at an EOC, so valueEnd is the enclosing bound. */
  indefinite: boolean;
};

function readTlv(buf: Buffer, offset: number, hardEnd: number): Tlv | null {
  if (offset + 2 > hardEnd) return null;
  const tag = buf[offset]!;
  let cursor = offset + 1;
  const lengthByte = buf[cursor]!;
  cursor += 1;

  // BouncyCastle writes CMS with indefinite lengths, so this is the common case.
  if (lengthByte === 0x80) {
    return { tag, headerEnd: cursor, valueEnd: hardEnd, indefinite: true };
  }

  let length = lengthByte;
  if (lengthByte & 0x80) {
    const byteCount = lengthByte & 0x7f;
    if (cursor + byteCount > hardEnd) return null;
    length = 0;
    for (let i = 0; i < byteCount; i += 1) {
      length = length * 256 + buf[cursor]!;
      cursor += 1;
    }
  }

  const valueEnd = cursor + length;
  if (valueEnd > hardEnd) return null;
  return { tag, headerEnd: cursor, valueEnd, indefinite: false };
}

function decodeOid(value: Buffer): string {
  const parts: number[] = [];
  const first = value[0] ?? 0;
  parts.push(Math.floor(first / 40), first % 40);
  let acc = 0;
  for (let i = 1; i < value.length; i += 1) {
    const byte = value[i]!;
    acc = acc * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(acc);
      acc = 0;
    }
  }
  return parts.join('.');
}

/**
 * Depth-first search for the signed attribute
 * `SEQUENCE { OID message-digest, SET { OCTET STRING } }`.
 */
export function extractCadesMessageDigest(cadesBase64: string): string | null {
  const der = Buffer.from(cadesBase64, 'base64');

  const walk = (start: number, end: number): string | null => {
    let offset = start;
    while (offset + 2 <= end) {
      const tlv = readTlv(der, offset, end);
      if (!tlv) return null;

      if (tlv.tag === TAG_EOC) {
        offset = tlv.valueEnd;
        continue;
      }

      const constructed = (tlv.tag & 0x20) !== 0;
      if (constructed) {
        const child = readTlv(der, tlv.headerEnd, tlv.valueEnd);
        if (child && child.tag === TAG_OID) {
          const oid = decodeOid(der.subarray(child.headerEnd, child.valueEnd));
          if (oid === MESSAGE_DIGEST_OID) {
            const set = readTlv(der, child.valueEnd, tlv.valueEnd);
            const octet = set ? readTlv(der, set.headerEnd, set.valueEnd) : null;
            if (octet && octet.tag === TAG_OCTET_STRING) {
              return der.subarray(octet.headerEnd, octet.valueEnd).toString('hex');
            }
          }
        }
        const found = walk(tlv.headerEnd, tlv.valueEnd);
        if (found) return found;
      }

      // An indefinite-length value already covered the rest of this range.
      if (tlv.indefinite) return null;
      offset = tlv.valueEnd;
    }
    return null;
  };

  return walk(0, der.length);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** SHA-256 of the canonical string of `document` with `signatures` removed. */
export function etaDocumentDigest(document: JsonObject): {
  canonical: string;
  digestHex: string;
} {
  const canonical = canonicalWithoutSignatures(document);
  return { canonical, digestHex: sha256Hex(canonical) };
}

export type DigestCheck =
  | { ok: true; digestHex: string; canonicalLength: number }
  | { ok: false; reason: string; digestHex: string; embeddedDigests: (string | null)[] };

/**
 * Assert every signature on the outgoing document was produced over exactly
 * these bytes. Blocks ETA's 4043 before it costs a duplicate-window round trip.
 */
export function verifySignedDigest(document: JsonObject): DigestCheck {
  const { canonical, digestHex } = etaDocumentDigest(document);
  const signatures = document.signatures;

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return {
      ok: false,
      reason: 'document has no signatures',
      digestHex,
      embeddedDigests: [],
    };
  }

  const embeddedDigests: (string | null)[] = [];
  for (const raw of signatures) {
    const value =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as { value?: unknown }).value
        : undefined;
    if (typeof value !== 'string' || !value) {
      embeddedDigests.push(null);
      continue;
    }
    embeddedDigests.push(extractCadesMessageDigest(value));
  }

  const mismatched = embeddedDigests.filter((d) => d !== digestHex);
  if (mismatched.length > 0) {
    return {
      ok: false,
      reason:
        'CAdES message-digest does not match the canonical digest of the outgoing document ' +
        '(signed bytes differ from submitted bytes; ETA would answer ITIDA 4043). ' +
        `expected=${digestHex} embedded=${embeddedDigests.map((d) => d ?? 'none').join(',')}`,
      digestHex,
      embeddedDigests,
    };
  }

  return { ok: true, digestHex, canonicalLength: canonical.length };
}
