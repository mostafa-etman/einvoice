/**
 * ETA eReceipt canonical serialization.
 *
 * Parallel to invoice `canonical-serialize.ts` (bassemAgmi SerializeToken).
 * The official receipt serialization page uses the same flatten algorithm;
 * this module is a separate copy so receipt goldens / uuid hashing can evolve
 * without touching the invoice CAdES digest path.
 *
 * UUID hashing serializes ONE receipt with `header.uuid` empty.
 * Batch `{ receipts: [...] }` signing is a later phase — not this module.
 */

export type ReceiptJsonPrimitive = string | number | boolean | null;
export type ReceiptJsonValue =
  | ReceiptJsonPrimitive
  | ReceiptJsonObject
  | ReceiptJsonValue[];
export type ReceiptJsonObject = { [key: string]: ReceiptJsonValue };

function jsonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function serializeScalar(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return jsonStringLiteral(value);
  }
  if (typeof value === 'boolean') {
    return `"${value}"`;
  }
  return `"${String(value)}"`;
}

function serializeObject(obj: ReceiptJsonObject): string {
  let out = '';
  for (const [key, value] of Object.entries(obj)) {
    const name = key.toUpperCase();
    out += `"${name}"`;
    if (value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        out += `"${name}"`;
        if (typeof item === 'string') {
          out += jsonStringLiteral(item);
        } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          out += serializeObject(item);
        } else if (item === null) {
          // nothing
        } else if (typeof item === 'boolean' || typeof item === 'number') {
          out += serializeScalar(item);
        }
      }
      continue;
    }
    if (typeof value === 'object') {
      out += serializeObject(value);
      continue;
    }
    out += serializeScalar(value);
  }
  return out;
}

/** Canonicalize one receipt object (not the `{ receipts: [...] }` batch wrapper). */
export function canonicalSerializeReceipt(receipt: ReceiptJsonObject): string {
  return serializeObject(receipt);
}
