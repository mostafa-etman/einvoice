import { ExportsService } from '../src/exports/exports.service';
import { tenantArtifactKey } from '../src/storage/minio-artifact.store';

type Row = Record<string, unknown>;

const TENANT = '8d6068e9-ae7d-44d6-bb88-c4311dfd902d';
const RID = 'PKG-READY-1';
const ZIP = Buffer.from('PK\u0003\u0004ready-package-bytes');

/**
 * Ready → Downloaded across the real service orchestration, with ETA stubbed
 * at the HTTP boundary (preprod cannot currently produce a package).
 */
describe('ETA package ready → stored → downloaded', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('polls until ready, stores the zip, and serves it from storage', async () => {
    process.env.PACKAGE_POLL_INITIAL_MS = '1';
    process.env.PACKAGE_POLL_MAX_MS = '2';

    let listCalls = 0;
    let downloadCalls = 0;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.includes('/documentpackages/requests')) {
        listCalls += 1;
        return new Response(
          JSON.stringify({
            result: [{ packageId: RID, status: listCalls < 2 ? 1 : 2 }],
            metadata: { totalCount: 1 },
          }),
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes(`/documentpackages/${RID}`)) {
        downloadCalls += 1;
        // First attempt: ETA answers 204 (still assembling).
        if (downloadCalls === 1) return new Response(null, { status: 204 });
        return new Response(ZIP, { status: 200 });
      }
      throw new Error(`unexpected call ${method} ${url}`);
    }) as typeof fetch;

    const jobs = new Map<string, Row>([
      [
        'job-1',
        {
          id: 'job-1',
          tenantId: TENANT,
          kind: 'ETA_PACKAGE',
          status: 'RUNNING',
          artifactObjectKeysJson: null,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    ]);
    const pkg: Row = {
      id: 'pkg-1',
      tenantId: TENANT,
      exportJobId: 'job-1',
      etaRequestId: RID,
      localStatus: 'REQUESTED',
    };

    const tx = {
      exportJob: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          jobs.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Row }) => {
          const next = { ...jobs.get(where.id), ...data };
          jobs.set(where.id, next);
          return next;
        },
      },
      etaPackageRequest: {
        findFirst: async () => pkg,
        update: async ({ data }: { data: Row }) => Object.assign(pkg, data),
      },
    };

    const stored = new Map<string, Buffer>();
    const service = new ExportsService(
      { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) } as never,
      { write: async () => undefined } as never,
      {
        withAccessToken: async (
          _tenantId: string,
          _opts: unknown,
          fn: (token: string) => Promise<unknown>,
        ) => fn('token'),
      } as never,
      {
        putByKey: async (key: string, body: Buffer) => {
          stored.set(key, body);
        },
        getByKey: async (key: string) => stored.get(key)!,
      } as never,
      { add: async () => undefined } as never,
      { add: async () => undefined } as never,
    );

    await service.processPackagePoll(TENANT, 'job-1', 'pkg-1');

    const expectedKey = tenantArtifactKey(TENANT, 'packages', `${RID}.zip`);
    expect(pkg.localStatus).toBe('READY');
    expect(pkg.packageObjectKey).toBe(expectedKey);
    expect(pkg.packageByteSize).toBe(ZIP.byteLength);
    expect(stored.get(expectedKey)).toEqual(ZIP);

    const job = jobs.get('job-1')!;
    expect(job.status).toBe('READY');
    expect(job.artifactObjectKeysJson).toEqual({ zip: expectedKey });
    expect(downloadCalls).toBe(2);

    Object.assign(job, { etaPackageRequest: pkg });
    const file = await service.download(TENANT, 'job-1');
    expect(file.contentType).toBe('application/zip');
    expect(file.fileName).toBe('eta-package-job-1.zip');
    expect(file.buffer).toEqual(ZIP);
  });
});
