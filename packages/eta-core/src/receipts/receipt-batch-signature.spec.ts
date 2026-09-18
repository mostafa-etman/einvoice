import {
  buildReceiptSignatures,
  buildReceiptSubmitBody,
  hashReceiptBatch,
  placeholderIssuerSignature,
  ReceiptSignatureRequiredError,
  splitReceiptBatch,
} from './receipt-batch-signature';
import { canonicalSerializeReceiptBatch } from './receipt-canonical';

const r1 = { header: { uuid: 'aa', receiptNumber: '1' }, totalAmount: 10 };
const r2 = { header: { uuid: 'bb', receiptNumber: '2' }, totalAmount: 20 };

describe('receipt batch signature (no invoice canonical)', () => {
  it('hashes the entire { receipts } batch, not each receipt', () => {
    const { canonical, digestHex } = hashReceiptBatch([r1, r2]);
    expect(canonical).toBe(canonicalSerializeReceiptBatch({ receipts: [r1, r2] }));
    expect(canonical.startsWith('"RECEIPTS""RECEIPTS"')).toBe(true);
    expect(digestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical).not.toContain('signatures');
  });

  it('default: issuer signatures[] present with empty placeholder value', async () => {
    const body = await buildReceiptSubmitBody([r1]);
    expect(body.receipts).toEqual([r1]);
    expect(body.signed).toBe(false);
    expect(body.signatures).toEqual([placeholderIssuerSignature()]);
    expect(body.signatures[0]?.signatureType).toBe('I');
    expect(body.signatures[0]?.value).toBe('');
  });

  it('uses a signer when provided (future PFX / CAdES)', async () => {
    const built = await buildReceiptSignatures([r1], {
      signer: { signDigest: (hex) => `cades-${hex.slice(0, 8)}` },
    });
    expect(built.signed).toBe(true);
    expect(built.signatures[0]?.value).toMatch(/^cades-[0-9a-f]{8}$/);
  });

  it('requireSignature without a signer throws', async () => {
    await expect(
      buildReceiptSignatures([r1], { requireSignature: true }),
    ).rejects.toBeInstanceOf(ReceiptSignatureRequiredError);
  });

  it('splits oversized batches and never drops a single oversized receipt', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ n: i, pad: 'x'.repeat(50) }));
    const chunks = splitReceiptBatch(many, {
      maxCount: 2,
      maxBytes: 10_000,
    });
    expect(chunks.every((c) => c.length <= 2)).toBe(true);
    expect(chunks.flat()).toEqual(many);

    const one = [{ huge: 'y'.repeat(100) }];
    expect(splitReceiptBatch(one, { maxBytes: 10 })).toEqual([one]);
  });
});
