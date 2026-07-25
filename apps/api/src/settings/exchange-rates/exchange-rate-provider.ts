/** Adapter interface for future FX providers. Manual rates are written directly. */
export interface ExchangeRateProvider {
  readonly name: string;
  fetchRate(input: {
    baseCurrencyCode: string;
    quoteCurrencyCode: string;
    asOf: Date;
  }): Promise<{ rate: string; asOf: Date } | null>;
}

export class NoopExchangeRateProvider implements ExchangeRateProvider {
  readonly name = 'noop';

  async fetchRate(): Promise<null> {
    return null;
  }
}
