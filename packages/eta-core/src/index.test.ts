import { canonicalSerialize, formatMoney } from './index.js';

describe('@einvoice/eta-core', () => {
  it('exports canonicalSerialize and money helpers', () => {
    expect(formatMoney('0')).toBe('0.00');
    expect(canonicalSerialize({ documentType: 'I' })).toBe('"DOCUMENTTYPE""I"');
  });
});
