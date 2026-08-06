import {
  isProductionProtectedDocument,
  resolveEtaHostUrls,
} from './eta-environment';

describe('eta-environment helpers', () => {
  const env = {
    ETA_IDENTITY_BASE_URL: 'https://id.preprod.eta.gov.eg',
    ETA_API_BASE_URL: 'https://api.preprod.invoicing.eta.gov.eg',
    ETA_PRODUCTION_IDENTITY_BASE_URL: 'https://id.eta.gov.eg',
    ETA_PRODUCTION_API_BASE_URL: 'https://api.invoicing.eta.gov.eg',
  };

  it('resolves sandbox vs production host pairs from config', () => {
    expect(resolveEtaHostUrls('SANDBOX', env).apiBaseUrl).toContain('preprod');
    expect(resolveEtaHostUrls('PRODUCTION', env).identityBaseUrl).toBe(
      'https://id.eta.gov.eg',
    );
    expect(resolveEtaHostUrls('PRODUCTION', env).label).toBe('production');
  });

  it('protects production documents that were submitted to ETA', () => {
    expect(
      isProductionProtectedDocument({
        etaEnvironment: 'PRODUCTION',
        etaUuid: 'uuid-1',
        etaStatus: 'Valid',
        status: 'VALID',
      }),
    ).toBe(true);

    expect(
      isProductionProtectedDocument({
        etaEnvironment: 'SANDBOX',
        etaUuid: 'uuid-1',
        etaStatus: 'Valid',
        status: 'VALID',
      }),
    ).toBe(false);

    expect(
      isProductionProtectedDocument({
        etaEnvironment: 'PRODUCTION',
        etaUuid: null,
        etaStatus: null,
        status: 'DRAFT',
      }),
    ).toBe(false);
  });
});
