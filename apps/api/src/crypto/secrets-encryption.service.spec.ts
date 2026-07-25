import { SecretsEncryptionService } from './secrets-encryption.service';

describe('SecretsEncryptionService', () => {
  const service = new SecretsEncryptionService();

  beforeAll(async () => {
    await service.ensureReady();
  });

  it('round-trips encrypt/decrypt', () => {
    const plain = 'eta-client-secret-value';
    const { ciphertext, nonce } = service.encrypt(plain);
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(nonce.length).toBeGreaterThan(0);
    expect(ciphertext.toString('utf8')).not.toContain(plain);
    expect(service.decrypt(ciphertext, nonce)).toBe(plain);
  });

  it('rejects empty plaintext', () => {
    expect(() => service.encrypt('')).toThrow(/empty/i);
  });
});
