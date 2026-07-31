import {
  mapEtaPackageStatus,
} from '../eta/eta-document-package.client';
import { EtaDocumentPackageClient } from '../eta/eta-document-package.client';
import { EtaPackageService } from './eta-package.service';

describe('eta-package status map (T044)', () => {
  it('maps ETA codes 1–4', () => {
    expect(mapEtaPackageStatus(1)).toBe('IN_PROGRESS');
    expect(mapEtaPackageStatus(2)).toBe('READY');
    expect(mapEtaPackageStatus(3)).toBe('ERROR');
    expect(mapEtaPackageStatus(4)).toBe('DELETED');
    expect(mapEtaPackageStatus(99)).toBe('UNKNOWN');
  });
});

describe('eta-package poll backoff / stall (T045)', () => {
  it('stalls after maxPolls with exponential backoff sleeps', async () => {
    const sleeps: number[] = [];
    const client = new EtaDocumentPackageClient(
      'https://api.preprod.invoicing.eta.gov.eg',
      async (input, init) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.endsWith('/documentpackages/requests')) {
          return new Response(JSON.stringify({ requestId: 'stall-1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'GET' && url.includes('/documentpackages/requests')) {
          return new Response(
            JSON.stringify({
              result: [{ requestId: 'stall-1', status: 1 }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('no', { status: 404 });
      },
    );

    const svc = new EtaPackageService(
      client,
      async () => ({ objectKey: 'unused' }),
      {
        pollInitialMs: 5,
        pollMaxMs: 40,
        maxPolls: 4,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    const result = await svc.requestAndDownload({
      accessToken: 't',
      body: {
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-02T00:00:00Z',
      },
    });

    expect(result.localStatus).toBe('STALLED');
    expect(result.polls).toBe(4);
    expect(sleeps.length).toBeGreaterThanOrEqual(3);
    expect(sleeps[0]).toBe(5);
    expect(sleeps[1]).toBe(10);
    expect(sleeps[2]).toBe(20);
  });
});
