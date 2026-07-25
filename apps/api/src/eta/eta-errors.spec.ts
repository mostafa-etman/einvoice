import { mapEtaHttpError, mapEtaOAuthError } from './eta-errors';

describe('eta-errors (mocked)', () => {
  it('maps known OAuth errors to stable codes', () => {
    expect(mapEtaOAuthError({ error: 'invalid_client' }, 401)).toMatchObject({
      code: 'invalid_client',
      httpStatus: 401,
    });
    expect(mapEtaOAuthError({ error: 'invalid_grant' }, 400).code).toBe(
      'invalid_grant',
    );
  });

  it('falls back for unknown bodies', () => {
    expect(mapEtaOAuthError(null, 401).code).toBe('unauthorized');
    expect(mapEtaHttpError(503, 'boom').code).toBe('eta_upstream_error');
  });
});
