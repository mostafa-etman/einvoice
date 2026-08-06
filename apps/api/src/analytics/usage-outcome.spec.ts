import { aggregateEventsToTotals } from './usage-aggregate';

describe('usage outcome supersede semantics (T030)', () => {
  it('after supersede only current outcome remains in aggregate', () => {
    // Simulate setDocumentOutcome: prior invalid deleted, valid remains
    const events = [
      {
        meter: 'valid' as const,
        quantity: 1,
        occurredAt: new Date(),
        documentId: 'd1',
      },
    ];
    expect(aggregateEventsToTotals(events)).toMatchObject({
      valid: 1,
      invalid: 0,
    });
  });
});
