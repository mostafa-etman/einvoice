import {
  buildBasicAuthHeader,
  buildBasicAuthHeaderValue,
  EtaAuthClient,
} from './eta-auth.client';

describe('EtaAuthClient (mocked)', () => {
  it('builds Basic auth as Base64(clientId:clientSecret)', () => {
    const value = buildBasicAuthHeaderValue('cid', 'csecret');
    expect(value).toBe(Buffer.from('cid:csecret', 'utf8').toString('base64'));
    expect(buildBasicAuthHeader('cid', 'csecret')).toBe(`Basic ${value}`);
  });

  it('POSTs client_credentials with Basic auth; never logs secret', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          access_token: 'tok-abc',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'InvoicingAPI',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const client = new EtaAuthClient('https://id.preprod.eta.gov.eg', fetchImpl);
    const token = await client.requestToken({
      clientId: 'my-client',
      clientSecret: 'my-secret',
      onBehalfOf: '999',
    });
    expect(token.access_token).toBe('tok-abc');
    expect(token.expires_in).toBe(3600);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://id.preprod.eta.gov.eg/connect/token',
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      buildBasicAuthHeader('my-client', 'my-secret'),
    );
    expect(headers.onbehalfof).toBe('999');
    expect(String(calls[0]!.init.body)).toContain('grant_type=client_credentials');
    expect(JSON.stringify(calls)).not.toContain('my-secret');
  });

  it('maps invalid_client from upstream', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    const client = new EtaAuthClient('https://id.preprod.eta.gov.eg', fetchImpl);
    await expect(
      client.requestToken({ clientId: 'x', clientSecret: 'y' }),
    ).rejects.toMatchObject({ etaCode: 'invalid_client', status: 401 });
  });
});
