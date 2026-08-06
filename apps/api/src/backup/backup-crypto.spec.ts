import { createHash } from 'crypto';
import {
  encryptArchive,
  packEncryptedArchive,
  decryptArchivePacked,
  verifyChecksum,
  sha256Hex,
} from './backup-crypto';

describe('backup-crypto', () => {
  it('round-trips encrypt/decrypt and detects checksum mismatch', async () => {
    const plain = Buffer.from(JSON.stringify({ hello: 'world', n: 3 }), 'utf8');
    const enc = await encryptArchive(plain);
    const packed = packEncryptedArchive(enc);
    expect(verifyChecksum(packed, enc.checksumSha256)).toBe(true);
    expect(verifyChecksum(packed, '00'.repeat(32))).toBe(false);
    const opened = await decryptArchivePacked(packed);
    expect(opened.toString('utf8')).toBe(plain.toString('utf8'));
    expect(sha256Hex(packed)).toBe(enc.checksumSha256);
    expect(createHash('sha256').update(packed).digest('hex')).toBe(enc.checksumSha256);
  });
});
