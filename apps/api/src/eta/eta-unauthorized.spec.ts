import { isEtaUnauthorized } from './eta.service';

describe('isEtaUnauthorized', () => {
  it('detects HTTP 401 from submit/lifecycle errors', () => {
    expect(isEtaUnauthorized({ httpStatus: 401, code: 'eta_upstream_error' })).toBe(
      true,
    );
    expect(isEtaUnauthorized({ status: 401 })).toBe(true);
    expect(isEtaUnauthorized({ code: 'unauthorized' })).toBe(true);
    expect(isEtaUnauthorized({ etaCode: 'invalid_token' })).toBe(true);
  });

  it('ignores non-auth failures', () => {
    expect(isEtaUnauthorized({ httpStatus: 422, code: 'ETA_DUPLICATE_SUBMISSION' })).toBe(
      false,
    );
    expect(isEtaUnauthorized({ httpStatus: 500 })).toBe(false);
    expect(isEtaUnauthorized(new Error('boom'))).toBe(false);
    expect(isEtaUnauthorized(null)).toBe(false);
  });
});
