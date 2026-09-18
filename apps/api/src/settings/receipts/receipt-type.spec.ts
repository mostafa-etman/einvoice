import { parseOptionalReceiptType, parseReceiptType, resolveReceiptType } from './receipt-type';

describe('resolveReceiptType', () => {
  it('lets the request override branch and tenant defaults', () => {
    expect(
      resolveReceiptType({
        requested: 'SR',
        branchDefault: 's',
        tenantDefault: 'r',
      }),
    ).toBe('SR');
  });

  it('uses the branch override when the request omits a type', () => {
    expect(
      resolveReceiptType({
        requested: '',
        branchDefault: 'r',
        tenantDefault: 's',
      }),
    ).toBe('r');
  });

  it('falls back to the tenant default', () => {
    expect(
      resolveReceiptType({
        requested: null,
        branchDefault: null,
        tenantDefault: 'SR',
      }),
    ).toBe('SR');
  });

  it('rejects unknown types instead of silently coercing', () => {
    expect(() => parseReceiptType('I')).toThrow();
    expect(parseOptionalReceiptType('')).toBeNull();
  });
});
