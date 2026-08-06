import { createHash } from 'crypto';
import sodium from 'libsodium-wrappers';
import { loadEnv } from '../config/env';

export type EncryptedArchive = {
  nonce: Buffer;
  ciphertext: Buffer;
  checksumSha256: string;
};

let ready: Promise<void> | null = null;
let archiveKey: Uint8Array | null = null;

async function ensureArchiveCrypto(): Promise<Uint8Array> {
  if (!ready) {
    ready = (async () => {
      await sodium.ready;
      const key = Buffer.from(loadEnv().BACKUP_ARCHIVE_MASTER_KEY, 'base64');
      if (key.length !== 32) {
        throw new Error('BACKUP_ARCHIVE_MASTER_KEY must be 32 bytes');
      }
      archiveKey = key;
    })();
  }
  await ready;
  if (!archiveKey) throw new Error('backup archive crypto not ready');
  return archiveKey;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Encrypt plaintext archive JSON/bytes. Never log plaintext. */
export async function encryptArchive(plaintext: Buffer): Promise<EncryptedArchive> {
  const key = await ensureArchiveCrypto();
  const nonce = Buffer.from(sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES));
  const ciphertext = Buffer.from(
    sodium.crypto_secretbox_easy(new Uint8Array(plaintext), new Uint8Array(nonce), key),
  );
  const packed = Buffer.concat([nonce, ciphertext]);
  return {
    nonce,
    ciphertext,
    checksumSha256: sha256Hex(packed),
  };
}

/** Pack nonce||ciphertext for storage. */
export function packEncryptedArchive(enc: EncryptedArchive): Buffer {
  return Buffer.concat([enc.nonce, enc.ciphertext]);
}

export async function decryptArchivePacked(packed: Buffer): Promise<Buffer> {
  const key = await ensureArchiveCrypto();
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  if (packed.length <= nonceLen) {
    throw new Error('Invalid archive package');
  }
  const nonce = packed.subarray(0, nonceLen);
  const ciphertext = packed.subarray(nonceLen);
  const opened = sodium.crypto_secretbox_open_easy(
    new Uint8Array(ciphertext),
    new Uint8Array(nonce),
    key,
  );
  if (!opened) {
    throw new Error('Failed to decrypt backup archive');
  }
  return Buffer.from(opened);
}

export function verifyChecksum(packed: Buffer, expectedSha256: string): boolean {
  return sha256Hex(packed) === expectedSha256.toLowerCase();
}
