import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function pngSize(buf: Buffer): { width: number; height: number } {
  const isPng =
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf.toString('ascii', 1, 4) === 'PNG';
  if (!isPng) {
    throw new Error('not a PNG');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('PWA icon files', () => {
  it('matches the manifest 192×192 and 512×512 declarations', () => {
    const publicDir = join(process.cwd(), 'public');
    expect(pngSize(readFileSync(join(publicDir, 'icon-192.png')))).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngSize(readFileSync(join(publicDir, 'icon-512.png')))).toEqual({
      width: 512,
      height: 512,
    });
  });
});
