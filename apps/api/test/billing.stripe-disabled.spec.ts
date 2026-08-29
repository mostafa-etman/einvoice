import { StripeBillingProvider } from '../src/billing/providers/stripe.provider';
import { PaymentProviderDisabledError } from '../src/billing/providers/stripe-config';

describe('StripeBillingProvider with placeholder keys', () => {
  const prev = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  });

  it('does not construct Stripe or surface Invalid API Key for CHANGE_ME', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_CHANGE_ME';
    const provider = new StripeBillingProvider();
    await expect(
      provider.createCheckoutSession({
        tenantId: 't1',
        planCode: 'STARTER',
        stripePriceId: 'price_x',
      }),
    ).rejects.toBeInstanceOf(PaymentProviderDisabledError);

    try {
      await provider.createCustomer({ tenantId: 't1', email: 'a@b.c' });
      throw new Error('expected disabled error');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentProviderDisabledError);
      expect(String(err)).not.toMatch(/Invalid API Key/i);
      expect(String(err)).not.toMatch(/CHANGE_ME/i);
    }
  });
});
