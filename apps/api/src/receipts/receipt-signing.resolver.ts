import { readFileSync } from 'node:fs';
import type { ReceiptCadesSigner } from '@einvoice/eta-core';
import { loadEnv } from '../config/env';

/**
 * Receipt CAdES resolver. Default: no cert, placeholder signatures.
 * If RECEIPT_CADES_PFX_PATH is set later, we load the PFX and expose a signer.
 * Real CMS/CAdES encoding is injected here so invoice cades-digest stays frozen.
 */

export type ReceiptSigningRuntime = {
  requireSignature: boolean;
  signer: ReceiptCadesSigner | null;
};

export function receiptSigningFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptSigningRuntime {
  const requireSignature =
    env.RECEIPT_REQUIRE_SIGNATURE === 'true' || env.RECEIPT_REQUIRE_SIGNATURE === '1';
  const path = env.RECEIPT_CADES_PFX_PATH?.trim();
  const password = env.RECEIPT_CADES_PFX_PASSWORD ?? '';
  if (!path) {
    return { requireSignature, signer: null };
  }
  return {
    requireSignature,
    signer: createPfxReceiptSigner(path, password),
  };
}

export function createPfxReceiptSigner(
  pfxPath: string,
  password: string,
): ReceiptCadesSigner {
  return {
    signDigest(digestHex: string) {
      // Load happens at sign time so missing files fail clearly only when used.
      const pfx = readFileSync(pfxPath);
      return signDigestWithPfx(pfx, password, digestHex);
    },
  };
}

/**
 * Interim RSA-SHA256 over the batch digest. Replace with a full CAdES-BES CMS
 * encoder when ETA enables receipt signature validation — do not use invoice
 * cades-digest.ts.
 */
export function signDigestWithPfx(
  pfx: Buffer,
  password: string,
  digestHex: string,
): string {
  // Lazy require so unit tests without a PFX never load node crypto PKCS#12.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const key = crypto.createPrivateKey({
    key: pfx,
    passphrase: password,
  });
  const sign = crypto.createSign('SHA256');
  sign.update(Buffer.from(digestHex, 'hex'));
  sign.end();
  return sign.sign(key).toString('base64');
}

export function loadReceiptSigningRuntime(): ReceiptSigningRuntime {
  loadEnv();
  return receiptSigningFromEnv();
}
