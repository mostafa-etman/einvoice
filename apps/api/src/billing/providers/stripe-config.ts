/**
 * Stripe is optional. Placeholder values such as `sk_test_CHANGE_ME` must never
 * be passed to the Stripe SDK (it throws `Invalid API Key provided: sk_test_*****CHANGE_ME`).
 */
export class PaymentProviderDisabledError extends Error {
  constructor(message = 'Online checkout is disabled') {
    super(message);
    this.name = 'PaymentProviderDisabledError';
  }
}

export function isConfiguredStripeSecret(raw?: string | null): boolean {
  const key = raw?.trim() ?? '';
  if (!key) return false;
  if (/CHANGE_ME/i.test(key)) return false;
  if (/placeholder|your[-_]?key|xxx+/i.test(key)) return false;
  if (!/^sk_(live|test)_/.test(key)) return false;
  return key.length >= 24;
}

export function isStripeInvalidApiKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid api key/i.test(msg);
}

export function guardStripeCallError(err: unknown): never {
  if (
    err instanceof PaymentProviderDisabledError ||
    isStripeInvalidApiKeyError(err)
  ) {
    throw new PaymentProviderDisabledError(
      'Stripe is not configured; online checkout is disabled',
    );
  }
  throw err;
}
