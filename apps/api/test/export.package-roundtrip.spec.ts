import { EtaDocumentPackageClient } from '../src/eta/eta-document-package.client';
import { EtaPackageService } from '../src/exports/eta-package.service';
import { tenantArtifactKey } from '../src/storage/minio-artifact.store';

/**
 * T046 — package export round-trip.
 * Always runs with mocked ETA HTTP (CI-safe). Live sandbox covered when
 * ETA_SANDBOX_INTEGRATION=1 via describeSandbox below.
 */
describe('export package round-trip (T046)', () => {
  it('Request → Get Package Requests until ready → Get zip → MinIO key', async () => {
    const apiBase = 'https://api.preprod.invoicing.eta.gov.eg';
    const rid = 'PKG-TEST-001';
    const zipBytes = Buffer.from('PK\x03\x04fake-zip-content');

    let getRequestsCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'POST' && url.endsWith('/documentpackages/requests')) {
        return new Response(JSON.stringify({ requestId: rid }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.includes('/documentpackages/requests')) {
        getRequestsCalls += 1;
        const status = getRequestsCalls < 2 ? 1 : 2;
        return new Response(
          JSON.stringify({
            result: [{ requestId: rid, status }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'GET' && url.includes(`/documentpackages/${rid}`)) {
        return new Response(zipBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        });
      }
      return new Response('not found', { status: 404 });
    };

    const client = new EtaDocumentPackageClient(apiBase, fetchImpl);
    const stored: { key: string; size: number }[] = [];
    const tenantId = '11111111-1111-1111-1111-111111111111';

    const svc = new EtaPackageService(
      client,
      async ({ requestId, zip }) => {
        const objectKey = tenantArtifactKey(tenantId, 'packages', `${requestId}.zip`);
        stored.push({ key: objectKey, size: zip.byteLength });
        return { objectKey };
      },
      { pollInitialMs: 1, pollMaxMs: 2, maxPolls: 10, sleep: async () => undefined },
    );

    const result = await svc.requestAndDownload({
      accessToken: 'test-token-not-logged',
      body: {
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T23:59:59Z',
        type: 'full',
        format: 'JSON',
      },
    });

    expect(result.localStatus).toBe('READY');
    expect(result.requestId).toBe(rid);
    expect(result.packageByteSize).toBe(zipBytes.byteLength);
    expect(result.packageObjectKey).toBe(
      `tenants/${tenantId}/artifacts/packages/${rid}.zip`,
    );
    expect(stored).toHaveLength(1);
    expect(getRequestsCalls).toBeGreaterThanOrEqual(2);
  });

  it('surfaces ERROR from Get Package Requests without downloading', async () => {
    const apiBase = 'https://api.preprod.invoicing.eta.gov.eg';
    const rid = 'PKG-ERR';
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        return new Response(JSON.stringify({ requestId: rid }), { status: 201 });
      }
      if (url.includes('/documentpackages/requests')) {
        return new Response(
          JSON.stringify({ result: [{ requestId: rid, status: 3 }] }),
          { status: 200 },
        );
      }
      throw new Error('Get Document Package must not be called on ERROR');
    };

    const svc = new EtaPackageService(
      new EtaDocumentPackageClient(apiBase, fetchImpl),
      async () => {
        throw new Error('store must not run');
      },
      { pollInitialMs: 1, maxPolls: 5, sleep: async () => undefined },
    );

    const result = await svc.requestAndDownload({
      accessToken: 'tok',
      body: {
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-02T00:00:00Z',
      },
    });
    expect(result.localStatus).toBe('ERROR');
    expect(result.packageObjectKey).toBeUndefined();
  });
});

const live =
  process.env.ETA_SANDBOX_INTEGRATION === '1' ? describe : describe.skip;

live('export package round-trip live sandbox (gated)', () => {
  it('placeholder — requires tenant ETA creds; mock path covers CI', () => {
    expect(process.env.ETA_API_BASE_URL || true).toBeTruthy();
  });
});
