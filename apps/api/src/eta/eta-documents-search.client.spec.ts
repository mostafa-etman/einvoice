import {
  buildEtaSearchWindows,
  EtaDocumentsSearchClient,
} from './eta-documents-search.client';
import { ETA_DOCUMENT_DIRECTION_RECEIVED } from '@einvoice/eta-core';

describe('EtaDocumentsSearchClient direction filter', () => {
  it('always requests direction=Received with submission date window', async () => {
    let requested = '';
    const fetchImpl = (async (url: string | URL) => {
      requested = String(url);
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    }) as typeof fetch;

    const client = new EtaDocumentsSearchClient('https://eta.test', fetchImpl);
    await client.searchReceived('tok', {
      pageSize: 10,
      window: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-15T23:59:59.000Z',
      },
    });

    expect(requested).toContain(`direction=${ETA_DOCUMENT_DIRECTION_RECEIVED}`);
    expect(requested).toContain('submissionDateFrom=');
    expect(requested).toContain('submissionDateTo=');
    expect(requested).not.toMatch(/direction=Issued/i);
  });

  it('buildEtaSearchWindows respects the 30-day ETA cap', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-03-01T00:00:00.000Z');
    const windows = buildEtaSearchWindows(from, to, 30);
    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) {
      const days =
        (w.to.getTime() - w.from.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeLessThanOrEqual(30);
    }
  });
});
