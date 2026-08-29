import {
  isConfiguredStripeSecret,
  isStripeInvalidApiKeyError,
} from './stripe-config';

describe('isConfiguredStripeSecret', () => {
  it('rejects missing and placeholder keys', () => {
    expect(isConfiguredStripeSecret(undefined)).toBe(false);
    expect(isConfiguredStripeSecret('')).toBe(false);
    expect(isConfiguredStripeSecret('sk_test_CHANGE_ME')).toBe(false);
    expect(isConfiguredStripeSecret('sk_test_*****CHANGE_ME')).toBe(false);
    expect(isConfiguredStripeSecret('whsec_CHANGE_ME')).toBe(false);
    expect(isConfiguredStripeSecret('not-a-stripe-key')).toBe(false);
  });

  it('accepts a plausible Stripe secret', () => {
    expect(isConfiguredStripeSecret(`sk_test_${'a'.repeat(24)}`)).toBe(true);
    expect(isConfiguredStripeSecret(`sk_live_${'b'.repeat(24)}`)).toBe(true);
  });
});

describe('isStripeInvalidApiKeyError', () => {
  it('detects the Stripe SDK placeholder-key message', () => {
    expect(
      isStripeInvalidApiKeyError(
        new Error('Invalid API Key provided: sk_test_*****CHANGE_ME'),
      ),
    ).toBe(true);
    expect(isStripeInvalidApiKeyError(new Error('network'))).toBe(false);
  });
});
