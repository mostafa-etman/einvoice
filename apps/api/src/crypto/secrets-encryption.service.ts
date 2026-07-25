import { Injectable, OnModuleInit } from '@nestjs/common';
import sodium from 'libsodium-wrappers';
import { loadEnv } from '../config/env';

export type EncryptedSecret = {
  ciphertext: Buffer;
  nonce: Buffer;
};

@Injectable()
export class SecretsEncryptionService implements OnModuleInit {
  private readyPromise: Promise<void> | null = null;
  private key: Uint8Array | null = null;

  async onModuleInit() {
    await this.ensureReady();
  }

  async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await sodium.ready;
        const env = loadEnv();
        const masterKey = env.SECRETS_MASTER_KEY;
        if (!masterKey) {
          throw new Error('SECRETS_MASTER_KEY is required');
        }
        this.key = Buffer.from(masterKey, 'base64');
        if (this.key.length !== 32) {
          throw new Error('SECRETS_MASTER_KEY must be 32 bytes');
        }
      })();
    }
    await this.readyPromise;
  }

  private getKey(): Uint8Array {
    if (!this.key) {
      throw new Error('SecretsEncryptionService not initialized');
    }
    return this.key;
  }

  /** Encrypt plaintext. Never log `plaintext`. */
  encrypt(plaintext: string): EncryptedSecret {
    if (!plaintext) {
      throw new Error('Cannot encrypt empty secret');
    }
    const key = this.getKey();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(
      sodium.from_string(plaintext),
      nonce,
      key,
    );
    return {
      ciphertext: Buffer.from(ciphertext),
      nonce: Buffer.from(nonce),
    };
  }

  /** Decrypt in memory only. Never log the result. */
  decrypt(ciphertext: Buffer | Uint8Array, nonce: Buffer | Uint8Array): string {
    const key = this.getKey();
    const opened = sodium.crypto_secretbox_open_easy(
      new Uint8Array(ciphertext),
      new Uint8Array(nonce),
      key,
    );
    if (!opened) {
      throw new Error('Failed to decrypt secret');
    }
    return sodium.to_string(opened);
  }
}
