import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EtaDocumentPackageClient,
  EtaDocumentPackageError,
} from '../eta/eta-document-package.client';
import { EMPTY_RANGE_SUMMARY, ExportsService } from './exports.service';

type Row = Record<string, unknown>;

/**
 * The Export screen used to render "Internal server error" because ETA
 * failures escaped as plain Errors. They must arrive as typed HTTP errors and
 * the job must be recorded as FAILED with the ETA detail.
 */
function buildService(opts: {
  documentCount: number;
  requestDocumentPackage: () => Promise<{ requestId: string }>;
}) {
  const jobs = new Map<string, Row>();
  let seq = 0;

  const tx = {
    document: { count: async () => opts.documentCount },
    exportJob: {
      create: async ({ data }: { data: Row }) => {
        const id = `job-${++seq}`;
        const row = { id, etaPackageRequest: null, ...data };
        jobs.set(id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { ...jobs.get(where.id), ...data };
        jobs.set(where.id, row);
        return row;
      },
      findFirst: async ({ where }: { where: { id: string } }) =>
        jobs.get(where.id) ?? null,
    },
    etaPackageRequest: {
      create: async ({ data }: { data: Row }) => ({ id: 'pkg-1', ...data }),
    },
  };

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
    {} as never,
    { add: async () => undefined } as never,
    { add: async () => undefined } as never,
  );

  jest
    .spyOn(EtaDocumentPackageClient.prototype, 'requestDocumentPackage')
    .mockImplementation(opts.requestDocumentPackage);

  return { service, jobs };
}

const args = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  dateFrom: '2026-07-01T00:00:00Z',
  dateTo: '2026-07-31T23:59:59Z',
};

afterEach(() => jest.restoreAllMocks());

describe('createEtaPackage error handling', () => {
  it('returns a clear empty result when no documents exist in the range', async () => {
    const { service } = buildService({
      documentCount: 0,
      requestDocumentPackage: async () => {
        throw new Error('ETA must not be called for an empty range');
      },
    });

    const job = (await service.createEtaPackage(args)) as Row;
    expect(job.status).toBe('FAILED');
    expect(job.errorSummary).toBe(EMPTY_RANGE_SUMMARY);
    expect(job.etaPackage).toBeNull();
  });

  it('rejects invalid parameters before contacting ETA', async () => {
    const { service } = buildService({
      documentCount: 5,
      requestDocumentPackage: async () => {
        throw new Error('ETA must not be called for invalid input');
      },
    });

    await expect(
      service.createEtaPackage({ ...args, type: 'Detailed' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps an ETA validation error to 400 and fails the job with the detail', async () => {
    const { service, jobs } = buildService({
      documentCount: 3,
      requestDocumentPackage: async () => {
        throw new EtaDocumentPackageError(
          'Request Document Package failed (400): BadRquest: Invalid Package Type',
          'ETA_PACKAGE_BAD_ARGUMENT',
          400,
          {
            etaCode: 'ValidationError',
            details: ['BadRquest: Invalid Package Type'],
          },
        );
      },
    });

    await expect(service.createEtaPackage(args)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        message: expect.stringContaining('Invalid Package Type'),
      }),
    });

    const job = [...jobs.values()][0]!;
    expect(job.status).toBe('FAILED');
    expect(String(job.errorSummary)).toContain('Invalid Package Type');
  });

  it('maps an ETA internal error to 503 including the correlation id', async () => {
    const { service } = buildService({
      documentCount: 3,
      requestDocumentPackage: async () => {
        throw new EtaDocumentPackageError(
          'Request Document Package failed (500)',
          'ETA_PACKAGE_REQUEST_FAILED',
          500,
          {
            etaCode: 'SystemError',
            details: ['InternalException: An internal exception occurred.'],
            correlationId: '0HNN:0001',
          },
        );
      },
    });

    const err = await service.createEtaPackage(args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('0HNN:0001');
  });
});
