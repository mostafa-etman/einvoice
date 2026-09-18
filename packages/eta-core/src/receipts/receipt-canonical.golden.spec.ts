import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSerializeReceipt } from './receipt-canonical.js';
import { buildReceipt } from './receipt-builder.js';
import { receiptWithEmptyUuid } from './receipt-uuid.js';
import { goldenSaleInput } from './golden-sale.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(__dirname, 'goldens');

function stripOneTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

describe('receipt canonicalSerializeReceipt golden (locked)', () => {
  const built = buildReceipt(goldenSaleInput());
  const hashed = receiptWithEmptyUuid(built.etaPayload);
  const canonical = canonicalSerializeReceipt(hashed);
  const expectedCanonical = stripOneTrailingNewline(
    readFileSync(join(GOLDENS, 'gv-receipt-01.canonical.txt'), 'utf8'),
  );
  const expectedUuid = stripOneTrailingNewline(
    readFileSync(join(GOLDENS, 'gv-receipt-01.uuid.txt'), 'utf8'),
  );

  it('matches byte-exact uuid-hash serialization', () => {
    expect(canonical).toBe(expectedCanonical);
  });

  it('locks the SHA-256 receipt uuid', () => {
    expect(built.uuid).toBe(expectedUuid);
    expect(built.uuid).toHaveLength(64);
  });

  it('does not include milliseconds in dateTimeIssued', () => {
    expect(String((built.etaPayload.header as { dateTimeIssued: string }).dateTimeIssued)).toBe(
      '2026-02-13T14:00:00Z',
    );
  });
});
