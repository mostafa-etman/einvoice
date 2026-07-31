/**
 * ONE canonical representation of an ETA document.
 *
 * ETA's canonical serialization walks object properties in order, so field
 * order is part of the signature. Postgres `jsonb` reorders keys, so the
 * document bytes must be kept as text from build time until submission:
 *
 *   build object -> serializeEtaDocument (text) -> canonical -> SHA-256 -> CAdES
 *                                              \-> same text is POSTed
 */

import { canonicalSerialize, type JsonObject, type JsonValue } from './canonical-serialize.js';

/** Exact ETA document bytes. Field order is preserved; no whitespace. */
export function serializeEtaDocument(document: JsonObject): string {
  return JSON.stringify(document);
}

/** Parse stored bytes back to an object; JSON.parse preserves key order. */
export function parseEtaDocument(text: string): JsonObject {
  const parsed = JSON.parse(text) as JsonValue;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ETA payload text is not a JSON object');
  }
  return parsed;
}

/**
 * True when text -> object -> text is byte-stable, i.e. the object we POST
 * serializes back to exactly the bytes that were signed.
 */
export function isRoundTripStable(text: string): boolean {
  try {
    return serializeEtaDocument(parseEtaDocument(text)) === text;
  } catch {
    return false;
  }
}

export function stripSignatures(document: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === 'signatures') continue;
    out[key] = value;
  }
  return out;
}

/** The exact canonical string that is hashed for the CAdES message-digest. */
export function canonicalWithoutSignatures(document: JsonObject): string {
  return canonicalSerialize(stripSignatures(document));
}

/** Attach signatures to the signed bytes without touching any other field. */
export function attachSignatures(
  document: JsonObject,
  signatures: JsonValue[],
): JsonObject {
  return { ...stripSignatures(document), signatures };
}
