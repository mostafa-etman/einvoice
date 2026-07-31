import { EtaDocumentsSearchClient } from './eta-documents-search.client';
import { ETA_DOCUMENT_DIRECTION_RECEIVED } from '@einvoice/eta-core';

describe('EtaDocumentsSearchClient direction filter', () => {
  it('always requests direction=Received', async () => {
    let requested = '';
    const fetchImpl = (async (url: string | URL) => {
      requested = String(url);
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    }) as typeof fetch;

    const client = new EtaDocumentsSearchClient('https://eta.test', fetchImpl);
    await client.searchReceived('tok', { pageSize: 10 });

    expect(requested).toContain(`direction=${ETA_DOCUMENT_DIRECTION_RECEIVED}`);
    expect(requested).not.toMatch(/direction=Issued/i);
  });
});
