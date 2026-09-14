import {
  formatEtaIntakeError,
  formatEtaIntakeErrorSummary,
  redactEtaLogJson,
} from './eta-intake-error.js';

const sample = {
  code: '2',
  message: 'Validation Error',
  target: 'CN10002MU0AF9U9',
  propertyPath: null,
  details: [
    {
      code: 'CF404',
      message: 'The referenced document is not Valid',
      target: 'references[0]',
      propertyPath: 'references',
    },
    {
      code: null,
      message: 'Quantity exceeds original invoice',
      target: 'invoiceLines[0].quantity',
    },
  ],
};

describe('formatEtaIntakeError', () => {
  it('includes code, target, and every details[] message', () => {
    const text = formatEtaIntakeError(sample);
    expect(text).toContain('code=2');
    expect(text).toContain('Validation Error');
    expect(text).toContain('target=CN10002MU0AF9U9');
    expect(text).toContain('The referenced document is not Valid');
    expect(text).toContain('Quantity exceeds original invoice');
    expect(text).toContain('propertyPath=references');
  });

  it('parses a JSON string the same way', () => {
    expect(formatEtaIntakeError(JSON.stringify(sample))).toContain(
      'The referenced document is not Valid',
    );
  });

  it('summarizes with the first detail rather than Validation Error', () => {
    expect(formatEtaIntakeErrorSummary(sample)).toBe(
      'The referenced document is not Valid',
    );
  });

  it('redacts credential keys without dropping validation details', () => {
    const redacted = redactEtaLogJson({
      message: 'Validation Error',
      clientSecret: 'super-secret',
      details: [{ message: 'bad ref', access_token: 'tok' }],
    }) as Record<string, unknown>;
    expect(redacted.clientSecret).toBe('[redacted]');
    expect(redacted.message).toBe('Validation Error');
    expect((redacted.details as Array<Record<string, unknown>>)[0]?.access_token).toBe(
      '[redacted]',
    );
    expect((redacted.details as Array<Record<string, unknown>>)[0]?.message).toBe(
      'bad ref',
    );
  });
});
