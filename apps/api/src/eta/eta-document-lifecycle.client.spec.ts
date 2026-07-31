import {
  EtaDocumentLifecycleClient,
  EtaDocumentLifecycleError,
} from './eta-document-lifecycle.client';

describe('EtaDocumentLifecycleClient', () => {
  const base = 'https://api.example.eta';

  it('PUTs reject with status rejected and reason', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const client = new EtaDocumentLifecycleClient(base, fetchImpl);
    await client.rejectDocument('tok', 'uuid-1', 'Not our goods');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `${base}/api/v1.0/documents/state/uuid-1/state`,
    );
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      status: 'rejected',
      reason: 'Not our goods',
    });
  });

  it('PUTs decline cancelation path', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const client = new EtaDocumentLifecycleClient(base, fetchImpl);
    await client.declineCancelation('tok', 'uuid-2');
    expect(calls[0]).toBe(
      `${base}/api/v1.0/documents/state/uuid-2/decline/cancelation`,
    );
  });

  it('maps non-OK responses to EtaDocumentLifecycleError', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: 'window closed' }), {
        status: 400,
      })) as typeof fetch;

    const client = new EtaDocumentLifecycleClient(base, fetchImpl);
    await expect(
      client.rejectDocument('tok', 'uuid-3', 'x'),
    ).rejects.toBeInstanceOf(EtaDocumentLifecycleError);
  });
});
