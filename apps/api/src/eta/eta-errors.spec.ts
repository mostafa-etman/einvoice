import { mapEtaHttpError, mapEtaOAuthError, stringifyEtaDetail } from './eta-errors';

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

  it('stringifies nested ETA error objects instead of [object Object]', () => {
    const body = JSON.stringify({
      error: {
        code: 'BadArgument',
        message: 'Invalid data',
        details: [
          { target: 'submissionDateFrom', message: 'The field is required' },
          { target: 'submissionDateTo', message: 'The field is required' },
        ],
      },
    });
    const mapped = mapEtaHttpError(400, body);
    expect(mapped.message).not.toContain('[object Object]');
    expect(mapped.message).toContain('Invalid data');
    expect(mapped.message).toContain('submissionDateFrom');
    expect(mapped.message).toContain('The field is required');
  });

  it('stringifyEtaDetail flattens details arrays', () => {
    expect(
      stringifyEtaDetail({
        message: 'Invalid data',
        details: [{ target: 'pageSize', message: 'must be <= 100' }],
      }),
    ).toContain('pageSize: must be <= 100');
  });
});
