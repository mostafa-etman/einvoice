import {
  buildPackageRequestPayload,
  EtaDocumentPackageClient,
  EtaDocumentPackageError,
  parseEtaPackageError,
} from '../src/eta/eta-document-package.client';
import { describeEtaError } from '../src/exports/exports.service';

const API_BASE = 'https://api.preprod.invoicing.eta.gov.eg';

/**
 * Regression guard for the "Internal server error" on Export → ETA package.
 * ETA answered 400 ValidationError/"Invalid Package Type" because the request
 * used lowercase enums and flat filters instead of `queryParameters`.
 */
describe('ETA document package request contract', () => {
  it('nests filters under queryParameters and PascalCases the enums', () => {
    const payload = buildPackageRequestPayload({
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.000Z',
      type: 'full',
      format: 'json',
      documentTypeNames: ['i', 'c'],
      statuses: ['valid', 'CANCELLED'],
    });

    expect(payload).toEqual({
      type: 'Full',
      format: 'JSON',
      queryParameters: {
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T23:59:59Z',
        documentTypeNames: ['I', 'C'],
        statuses: ['Valid', 'Cancelled'],
        truncateifexceeded: true,
      },
    });
  });

  it('rejects bad arguments locally instead of letting ETA 400', () => {
    expect(() =>
      buildPackageRequestPayload({
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T00:00:00Z',
        type: 'Detailed',
      }),
    ).toThrow(/Full or Summary/);

    expect(() =>
      buildPackageRequestPayload({
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T00:00:00Z',
        type: 'Full',
        format: 'CSV',
      }),
    ).toThrow(/CSV packages are only available for Summary/);

    expect(() =>
      buildPackageRequestPayload({
        dateFrom: '2026-07-31T00:00:00Z',
        dateTo: '2026-07-01T00:00:00Z',
      }),
    ).toThrow(/dateFrom must be before dateTo/);

    expect(() =>
      buildPackageRequestPayload({ dateFrom: 'not-a-date', dateTo: '2026-07-01T00:00:00Z' }),
    ).toThrow(/dateFrom must be a valid date/);

    expect(() =>
      buildPackageRequestPayload({
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T00:00:00Z',
        statuses: ['approved'],
      }),
    ).toThrow(/Valid, Invalid, Rejected or Cancelled/);
  });

  it('sends the documented wire shape over HTTP', async () => {
    let sentBody: unknown;
    const client = new EtaDocumentPackageClient(API_BASE, async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ packageId: 'PKG-1' }), { status: 201 });
    });

    const result = await client.requestDocumentPackage('tok', {
      dateFrom: '2026-07-01T00:00:00Z',
      dateTo: '2026-07-31T23:59:59Z',
      type: 'full',
      format: 'JSON',
    });

    expect(result.requestId).toBe('PKG-1');
    expect(sentBody).toMatchObject({
      type: 'Full',
      format: 'JSON',
      queryParameters: { dateFrom: '2026-07-01T00:00:00Z' },
    });
    expect(sentBody).not.toHaveProperty('dateFrom');
  });
});

describe('ETA package error surfacing', () => {
  it('extracts the ETA validation detail instead of a bare status code', async () => {
    const body = JSON.stringify({
      error: {
        code: 'ValidationError',
        message: null,
        details: [{ target: 'BadRquest', message: 'Invalid Package Type' }],
      },
    });
    const client = new EtaDocumentPackageClient(
      API_BASE,
      async () => new Response(body, { status: 400 }),
    );

    const err = await client
      .requestDocumentPackage('tok', {
        dateFrom: '2026-07-01T00:00:00Z',
        dateTo: '2026-07-31T00:00:00Z',
      })
      .catch((e: unknown) => e as EtaDocumentPackageError);

    expect(err).toBeInstanceOf(EtaDocumentPackageError);
    expect(err.code).toBe('ETA_PACKAGE_BAD_ARGUMENT');
    expect(err.etaCode).toBe('ValidationError');
    expect(err.message).toContain('Invalid Package Type');
    expect(describeEtaError(err)).toBe(
      'ValidationError — BadRquest: Invalid Package Type',
    );
  });

  it('keeps the ETA correlation id for internal ETA failures', () => {
    const err = parseEtaPackageError(
      JSON.stringify({
        error: {
          code: 'SystemError',
          details: [
            {
              target: 'InternalException',
              message:
                'An internal exception occurred. For more details send the correlation id: [0HNNCMDB140R1:00000001] to the administrator',
            },
          ],
        },
      }),
      500,
      'ETA_PACKAGE_REQUEST_FAILED',
      'Request Document Package',
    );

    expect(err.correlationId).toBe('0HNNCMDB140R1:00000001');
    expect(describeEtaError(err)).toContain('correlation id 0HNNCMDB140R1:00000001');
  });

  it('does not throw on an empty or malformed package list', async () => {
    const empty = new EtaDocumentPackageClient(
      API_BASE,
      async () =>
        new Response(JSON.stringify({ result: [], metadata: { totalCount: 0 } }), {
          status: 200,
        }),
    );
    await expect(empty.getPackageRequests('tok')).resolves.toEqual([]);

    const nulls = new EtaDocumentPackageClient(
      API_BASE,
      async () => new Response(JSON.stringify({ result: [null, {}] }), { status: 200 }),
    );
    await expect(nulls.getPackageRequests('tok')).resolves.toEqual([]);
  });

  it('treats a 200 with an empty body as not ready', async () => {
    const client = new EtaDocumentPackageClient(
      API_BASE,
      async () => new Response(new ArrayBuffer(0), { status: 200 }),
    );
    await expect(client.getDocumentPackage('tok', 'PKG-1')).resolves.toEqual({
      ready: false,
    });
  });

  it('reads packageId from the Get Package Requests list', async () => {
    const client = new EtaDocumentPackageClient(
      API_BASE,
      async () =>
        new Response(
          JSON.stringify({ result: [{ packageId: 'PKG-9', status: 2 }] }),
          { status: 200 },
        ),
    );
    await expect(client.getPackageRequests('tok')).resolves.toEqual([
      { requestId: 'PKG-9', status: 2 },
    ]);
  });
});
