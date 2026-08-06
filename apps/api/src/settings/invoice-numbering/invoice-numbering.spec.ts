import { formatInternalId } from '@einvoice/eta-core';

describe('invoice numbering format', () => {
  it('pads sequence numbers', () => {
    expect(formatInternalId('INV-', 1, 6)).toBe('INV-000001');
    expect(formatInternalId('CN-', 42, 4)).toBe('CN-0042');
  });
});
