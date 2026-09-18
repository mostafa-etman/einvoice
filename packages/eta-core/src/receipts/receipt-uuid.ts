import type { ReceiptJsonObject } from './receipt-canonical.js';
import { canonicalSerializeReceipt } from './receipt-canonical.js';
import { sha256Hex } from './receipt-sha256.js';

const UUID_HEX = /^[0-9a-f]{64}$/;

export function isReceiptUuid(value: string): boolean {
  return UUID_HEX.test(value);
}

/** POS chain: empty string on that device's first receipt. */
export function previousUuidForPos(
  lastReceiptUuid: string | null | undefined,
): string {
  return (lastReceiptUuid ?? '').trim();
}

export function receiptWithEmptyUuid(receipt: ReceiptJsonObject): ReceiptJsonObject {
  const headerRaw = receipt.header;
  const header =
    headerRaw && typeof headerRaw === 'object' && !Array.isArray(headerRaw)
      ? { ...headerRaw, uuid: '' }
      : { uuid: '' };
  return { ...receipt, header };
}

/**
 * Per-receipt identity uuid: SHA-256 hex of the canonical receipt with uuid empty.
 * This is NOT the CAdES batch digest.
 */
export function computeReceiptUuid(receipt: ReceiptJsonObject): string {
  const canonical = canonicalSerializeReceipt(receiptWithEmptyUuid(receipt));
  return sha256Hex(canonical);
}

export function stampReceiptUuid(receipt: ReceiptJsonObject): {
  receipt: ReceiptJsonObject;
  uuid: string;
  uuidCanonicalString: string;
  canonicalString: string;
} {
  const forHash = receiptWithEmptyUuid(receipt);
  const uuidCanonicalString = canonicalSerializeReceipt(forHash);
  const uuid = sha256Hex(uuidCanonicalString);
  const headerRaw = forHash.header;
  const header =
    headerRaw && typeof headerRaw === 'object' && !Array.isArray(headerRaw)
      ? { ...headerRaw, uuid }
      : { uuid };
  const stamped = { ...receipt, header };
  return {
    receipt: stamped,
    uuid,
    uuidCanonicalString,
    canonicalString: canonicalSerializeReceipt(stamped),
  };
}
