import { apiFetch } from './client';

export type Currency = {
  code: string;
  nameEn: string;
  nameAr: string;
  decimals: number;
};

export type TenantCurrency = {
  currencyCode: string;
  isDefault: boolean;
  currency?: Currency;
};

export type ExchangeRate = {
  id: string;
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rate: string;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function listCurrencyCatalog() {
  return apiFetch<Currency[]>('/currencies/catalog', { tenantScoped: true });
}

export function listTenantCurrencies() {
  return apiFetch<TenantCurrency[]>('/currencies', { tenantScoped: true });
}

export function enableCurrency(currencyCode: string, isDefault?: boolean) {
  return apiFetch<TenantCurrency>('/currencies', {
    method: 'POST',
    tenantScoped: true,
    body: { currencyCode, isDefault },
  });
}

export function setDefaultCurrency(currencyCode: string) {
  return apiFetch<TenantCurrency>('/currencies/default', {
    method: 'PUT',
    tenantScoped: true,
    body: { currencyCode },
  });
}

export function listExchangeRates() {
  return apiFetch<ExchangeRate[]>('/exchange-rates', { tenantScoped: true });
}

export function createExchangeRate(body: {
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}) {
  return apiFetch<ExchangeRate>('/exchange-rates', {
    method: 'POST',
    tenantScoped: true,
    body,
  });
}
