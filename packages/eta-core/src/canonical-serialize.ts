/**
 * ETA canonical serialization matching bassemAgmi/EInvoicingSigner SerializeToken.
 * See packages/eta-core/docs/reference-algorithm.md
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

function jsonStringLiteral(value: string): string {
  // JsonConvert.ToString(string) ≡ JSON.stringify for typical invoice text
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

function serializeObject(obj: JsonObject): string {
  let out = '';
  for (const [key, value] of Object.entries(obj)) {
    const name = key.toUpperCase();
    out += `"${name}"`;
    if (value === null) {
      // name only
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

/**
 * Canonicalize one ETA document object (not the submission `{ documents: [...] }` wrapper).
 */
export function canonicalSerialize(document: JsonObject): string {
  return serializeObject(document);
}
