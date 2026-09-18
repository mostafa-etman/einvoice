/**
 * eReceipt submit-body signatures[] — parallel to invoices, never imported
 * from invoice canonical/CAdES modules.
 *
 * ETA currently does not validate receipt CAdES ("signature validation will
 * not be deployed at this point"). Issuer `signatures[]` must still be present.
 * Default: structurally valid `{ signatureType: "I", value: "" }`.
 * When a signer is supplied (later PFX), value is Base64 CAdES-BES of the
 * SHA-256 of the canonical `{ receipts: [...] }` batch.
 */

import { canonicalSerializeReceiptBatch, type ReceiptJsonObject } from './receipt-canonical.js';
import { sha256Hex } from './receipt-sha256.js';

export const RECEIPT_ISSUER_SIGNATURE_TYPE = 'I' as const;
export const RECEIPT_SERVICE_PROVIDER_SIGNATURE_TYPE = 'S' as const;

export type ReceiptSubmitSignature = {
  signatureType: typeof RECEIPT_ISSUER_SIGNATURE_TYPE | typeof RECEIPT_SERVICE_PROVIDER_SIGNATURE_TYPE;
  value: string;
};

export type ReceiptCadesSigner = {
  /** Return Base64 CAdES-BES over the 32-byte SHA-256 digest. */
  signDigest(digestHex: string): Promise<string> | string;
};

export type ReceiptSignatureOptions = {
  /** When true, a real signer is required (no placeholder). Default false. */
  requireSignature?: boolean;
  signer?: ReceiptCadesSigner | null;
};

export class ReceiptSignatureRequiredError extends Error {
  readonly code = 'RECEIPT_SIGNATURE_REQUIRED';
  constructor(message = 'Receipt CAdES certificate is required but not configured.') {
    super(message);
    this.name = 'ReceiptSignatureRequiredError';
  }
}

export function hashReceiptBatch(receipts: ReceiptJsonObject[]): {
  canonical: string;
  digestHex: string;
} {
  const canonical = canonicalSerializeReceiptBatch({ receipts });
  return { canonical, digestHex: sha256Hex(canonical) };
}

export function placeholderIssuerSignature(): ReceiptSubmitSignature {
  return { signatureType: RECEIPT_ISSUER_SIGNATURE_TYPE, value: '' };
}

export async function buildReceiptSignatures(
  receipts: ReceiptJsonObject[],
  opts: ReceiptSignatureOptions = {},
): Promise<{
  signatures: ReceiptSubmitSignature[];
  canonical: string;
  digestHex: string;
  signed: boolean;
}> {
  const { canonical, digestHex } = hashReceiptBatch(receipts);
  const requireSignature = Boolean(opts.requireSignature);
  const signer = opts.signer ?? null;

  if (signer) {
    const value = await signer.signDigest(digestHex);
    return {
      signatures: [{ signatureType: RECEIPT_ISSUER_SIGNATURE_TYPE, value }],
      canonical,
      digestHex,
      signed: true,
    };
  }

  if (requireSignature) {
    throw new ReceiptSignatureRequiredError();
  }

  return {
    signatures: [placeholderIssuerSignature()],
    canonical,
    digestHex,
    signed: false,
  };
}

export async function buildReceiptSubmitBody(
  receipts: ReceiptJsonObject[],
  opts: ReceiptSignatureOptions = {},
): Promise<{
  receipts: ReceiptJsonObject[];
  signatures: ReceiptSubmitSignature[];
  canonical: string;
  digestHex: string;
  signed: boolean;
}> {
  const built = await buildReceiptSignatures(receipts, opts);
  return { receipts, ...built };
}

/** Split a batch so each chunk stays under ETA's 1.5 MB / 500-receipt limits. */
export const ETA_RECEIPT_MAX_PER_SUBMISSION = 500;
export const ETA_RECEIPT_MAX_BYTES = 1_500_000;

export function splitReceiptBatch<T>(
  receipts: T[],
  opts?: { maxCount?: number; maxBytes?: number; serialize?: (chunk: T[]) => string },
): T[][] {
  const maxCount = opts?.maxCount ?? ETA_RECEIPT_MAX_PER_SUBMISSION;
  const maxBytes = opts?.maxBytes ?? ETA_RECEIPT_MAX_BYTES;
  const serialize =
    opts?.serialize ??
    ((chunk: T[]) => JSON.stringify({ receipts: chunk, signatures: [{ signatureType: 'I', value: '' }] }));

  const byteLen = (s: string) => new TextEncoder().encode(s).length;

  if (receipts.length === 0) return [];
  if (receipts.length === 1) return [receipts];

  const fits = (chunk: T[]) =>
    chunk.length <= maxCount && byteLen(serialize(chunk)) <= maxBytes;

  const out: T[][] = [];
  let current: T[] = [];
  for (const row of receipts) {
    const next = [...current, row];
    if (current.length > 0 && !fits(next)) {
      out.push(current);
      current = [row];
    } else {
      current = next;
    }
  }
  if (current.length) out.push(current);

  // If a pre-built chunk still exceeds size and has >1 item, split in half.
  const refined: T[][] = [];
  for (const chunk of out) {
    refined.push(...halveUntilFits(chunk, fits));
  }
  return refined;
}

function halveUntilFits<T>(chunk: T[], fits: (c: T[]) => boolean): T[][] {
  if (chunk.length <= 1 || fits(chunk)) return [chunk];
  const mid = Math.ceil(chunk.length / 2);
  return [
    ...halveUntilFits(chunk.slice(0, mid), fits),
    ...halveUntilFits(chunk.slice(mid), fits),
  ];
}
