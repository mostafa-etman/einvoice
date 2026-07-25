import { canonicalSerialize } from './canonical-serialize.js';

describe('canonicalSerialize edges', () => {
  it('uppercases ASCII property names', () => {
    expect(canonicalSerialize({ documentType: 'I' })).toBe('"DOCUMENTTYPE""I"');
  });

  it('emits empty array name once', () => {
    expect(canonicalSerialize({ invoiceLines: [] })).toBe('"INVOICELINES"');
  });

  it('emits null as name only', () => {
    expect(canonicalSerialize({ bankAccountIBAN: null, bankName: 'SomeBank' })).toBe(
      '"BANKACCOUNTIBAN""BANKNAME""SomeBank"',
    );
  });

  it('escapes quotes in string values (JsonConvert.ToString semantics)', () => {
    expect(canonicalSerialize({ description: 'say "hi"' })).toBe(
      '"DESCRIPTION""say \\"hi\\""',
    );
  });

  it('preserves Arabic UTF-8', () => {
    const out = canonicalSerialize({ name: 'الشركة المصدرة' });
    expect(out).toContain('الشركة المصدرة');
  });
});
