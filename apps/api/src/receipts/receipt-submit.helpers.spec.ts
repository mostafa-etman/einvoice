import { splitReceiptBatch } from '@einvoice/eta-core';
import { lastUuidAfterAccept, lastUuidAfterReject } from './receipt-chain';
import { receiptSigningFromEnv } from './receipt-signing.resolver';

describe('receipt submission helpers', () => {
  it('default signing env does not require a certificate', () => {
    const runtime = receiptSigningFromEnv({
      RECEIPT_REQUIRE_SIGNATURE: 'false',
    } as NodeJS.ProcessEnv);
    expect(runtime.requireSignature).toBe(false);
    expect(runtime.signer).toBeNull();
  });

  it('require-signature flag is on when env says so, still no signer without PFX', () => {
    const runtime = receiptSigningFromEnv({
      RECEIPT_REQUIRE_SIGNATURE: 'true',
    } as NodeJS.ProcessEnv);
    expect(runtime.requireSignature).toBe(true);
    expect(runtime.signer).toBeNull();
  });

  it('MaximumSize split halves a large batch; a single receipt is not dropped', () => {
    const receipts = Array.from({ length: 6 }, (_, i) => ({ i, blob: 'n'.repeat(20) }));
    const chunks = splitReceiptBatch(receipts, { maxCount: 2, maxBytes: 50_000 });
    expect(chunks.every((c) => c.length <= 2)).toBe(true);
    expect(chunks.flat().map((r) => r.i)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(splitReceiptBatch([{ i: 1 }], { maxBytes: 1 })).toEqual([[{ i: 1 }]]);
  });

  it('advances chain on accept only; reject rolls back the tip', () => {
    const afterSave = lastUuidAfterAccept('', 'new', '');
    expect(afterSave).toBe('new');
    expect(lastUuidAfterReject('new', 'new', '')).toBe('');
    expect(lastUuidAfterAccept('new', 'new', '')).toBe('new');
  });
});
