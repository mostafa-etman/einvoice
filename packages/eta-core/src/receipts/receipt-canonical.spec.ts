import { canonicalSerializeReceipt } from './receipt-canonical.js';

describe('canonicalSerializeReceipt edges', () => {
  it('uppercases ASCII property names', () => {
    expect(canonicalSerializeReceipt({ receiptType: 's' })).toBe('"RECEIPTTYPE""s"');
  });

  it('emits empty array name once', () => {
    expect(canonicalSerializeReceipt({ itemData: [] })).toBe('"ITEMDATA"');
  });

  it('emits null as name only', () => {
    expect(canonicalSerializeReceipt({ referenceUUID: null, currency: 'EGP' })).toBe(
      '"REFERENCEUUID""CURRENCY""EGP"',
    );
  });

  it('stringifies numbers (including 0) without forcing 0.00', () => {
    expect(canonicalSerializeReceipt({ feesAmount: 0, totalAmount: 114 })).toBe(
      '"FEESAMOUNT""0""TOTALAMOUNT""114"',
    );
  });

  it('JSON-stringifies string values including empty uuid', () => {
    expect(canonicalSerializeReceipt({ uuid: '' })).toBe('"UUID"""');
  });
});
