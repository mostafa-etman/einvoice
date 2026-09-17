/**
 * ETA receiver (buyer) payload helpers.
 *
 * Official credit-note / invoice schema (sdk.invoicing.eta.gov.eg):
 *   type  — required, B | P | F
 *   id    — conditional (registration / national ID / VAT ID)
 *   name  — conditional
 *   address — conditional; same address fields as issuer EXCEPT branchId
 *
 * `branch` / `branchId` is an **issuer.address** field, not a receiver field.
 * Sending `receiver.branch: null` (or an empty/invalid `type`) fails ETA intake.
 */

import type { JsonObject } from './canonical-serialize.js';

export const ETA_RECEIVER_TYPES = ['B', 'P', 'F'] as const;
export type EtaReceiverType = (typeof ETA_RECEIVER_TYPES)[number];

const RECEIVER_TYPE_ALIASES: Record<string, EtaReceiverType> = {
  b: 'B',
  business: 'B',
  company: 'B',
  شركه: 'B',
  شركة: 'B',
  p: 'P',
  person: 'P',
  personal: 'P',
  شخصي: 'P',
  f: 'F',
  foreign: 'F',
  foreigner: 'F',
  اجنبي: 'F',
  أجنبي: 'F',
};

const RECEIVER_CORE_KEYS = new Set(['type', 'id', 'name', 'address']);

function foldReceiverType(raw: string): string {
  return raw
    .trim()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickField(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function cleanString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function isEtaReceiverType(value: unknown): value is EtaReceiverType {
  return value === 'B' || value === 'P' || value === 'F';
}

/**
 * Map a user/stored receiver type onto B/P/F.
 * Document types (I/C/D/EI/EC/ED) are NOT valid receiver types — they fall back.
 */
export function normalizeEtaReceiverType(
  raw: unknown,
  fallback: EtaReceiverType = 'B',
): EtaReceiverType {
  const text = cleanString(raw);
  if (!text) return fallback;
  const aliased = RECEIVER_TYPE_ALIASES[foldReceiverType(text)];
  if (aliased) return aliased;
  const upper = text.toUpperCase();
  if (isEtaReceiverType(upper)) return upper;
  return fallback;
}

/** Drop null / blank address fields so ETA never sees `branchID: null`. */
export function compactEtaAddress(raw: unknown): JsonObject | undefined {
  const src = asRecord(raw);
  if (!src) return undefined;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(src)) {
    if (value == null || value === '') continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = trimmed;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build the ETA `receiver` object: valid type, no blank strings, no null extras.
 * Extra keys from an original invoice (e.g. a non-empty `branch`) are kept;
 * null/blank `branch` is omitted — it is not a required receiver field.
 */
export function compactEtaReceiver(
  raw: unknown,
  opts?: { isExport?: boolean },
): JsonObject {
  const fallback: EtaReceiverType = opts?.isExport ? 'F' : 'B';
  const src = asRecord(raw) ?? {};
  const typeFromDoc = pickField(src, 'type', 'Type');
  const type = opts?.isExport
    ? 'F'
    : normalizeEtaReceiverType(typeFromDoc, fallback);

  const out: JsonObject = { type };

  const id = cleanString(pickField(src, 'id', 'Id', 'ID'));
  if (id) out.id = id;

  const name = cleanString(pickField(src, 'name', 'Name'));
  if (name) out.name = name;

  const address = compactEtaAddress(pickField(src, 'address', 'Address') ?? src.address);
  if (address) out.address = address;

  for (const [key, value] of Object.entries(src)) {
    if (RECEIVER_CORE_KEYS.has(key) || key === 'Type' || key === 'Id' || key === 'ID' || key === 'Name' || key === 'Address') {
      continue;
    }
    if (value == null || value === '') continue;
    if (typeof value === 'object') continue;
    const asText = typeof value === 'string' ? value.trim() : String(value).trim();
    if (!asText) continue;
    if (typeof value === 'string') {
      out[key] = asText;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }

  return out;
}

/** Merge stored columns + original etaPayload.receiver (payload wins, extras kept). */
export function receiverFromStoredDocument(doc: {
  kind?: string | null;
  receiverType?: string | null;
  receiverId?: string | null;
  receiverName?: string | null;
  receiverAddressJson?: unknown;
  etaPayloadJson?: unknown;
}): JsonObject {
  const payload = asRecord(doc.etaPayloadJson) ?? {};
  const fromPayload = asRecord(payload.receiver) ?? asRecord(payload.Receiver) ?? {};
  const merged: Record<string, unknown> = {
    ...fromPayload,
    type: pickField(fromPayload, 'type', 'Type') ?? doc.receiverType,
    id: pickField(fromPayload, 'id', 'Id', 'ID') ?? doc.receiverId,
    name: pickField(fromPayload, 'name', 'Name') ?? doc.receiverName,
    address:
      pickField(fromPayload, 'address', 'Address') ?? doc.receiverAddressJson,
  };
  return compactEtaReceiver(merged, {
    isExport: String(doc.kind ?? '').startsWith('EXPORT'),
  });
}
