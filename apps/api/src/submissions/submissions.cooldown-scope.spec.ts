import { ConflictException } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { etaDocumentDigest } from './cades-digest';
import { IN_FLIGHT_STALE_MS } from './submit-cooldown';
import type { JsonObject } from '@einvoice/eta-core';

type DocRow = {
  id: string;
  tenantId: string;
  internalId: string;
  etaPayloadText: string | null;
  submitCooldownUntil: Date | null;
  submitCooldownPayloadHash: string | null;
  submitInFlight: boolean;
  submitInFlightSince: Date | null;
  submitAttemptLog: unknown;
  submitPendingRetrySubmissionId: string | null;
};

const TENANT = 'tenant-1';

function payloadText(internalId: string): string {
  return JSON.stringify({
    issuer: { id: '123456789', name: 'Seller' },
    receiver: { id: '987654321', name: 'Buyer' },
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: '2026-07-31T12:00:00Z',
    internalID: internalId,
    invoiceLines: [],
    totalAmount: 100,
  });
}

function hashOf(text: string): string {
  return etaDocumentDigest(JSON.parse(text) as JsonObject).digestHex;
}

function docRow(overrides: Partial<DocRow> & { id: string }): DocRow {
  const text = payloadText(overrides.id.toUpperCase());
  return {
    tenantId: TENANT,
    internalId: overrides.id.toUpperCase(),
    etaPayloadText: text,
    submitCooldownUntil: null,
    submitCooldownPayloadHash: null,
    submitInFlight: false,
    submitInFlightSince: null,
    submitAttemptLog: [],
    submitPendingRetrySubmissionId: null,
    ...overrides,
  };
}

/** Minimal in-memory stand-in for the tenant-scoped Prisma client. */
function makeService(rows: DocRow[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const tx = {
    document: {
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .map((id) => store.get(id))
            .filter((r): r is DocRow => Boolean(r)),
        ),
      findFirst: ({ where }: { where: { id: string } }) =>
        Promise.resolve(store.get(where.id) ?? null),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = store.get(where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
  };
  const tenantPrisma = {
    withTenant: (_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new SubmissionsService(
    tenantPrisma as never,
    { getAccessToken: jest.fn() } as never,
    { write: jest.fn() } as never,
  );
  const gate = (ids: string[]) =>
    (
      service as unknown as {
        assertDocumentsSubmittable: (
          t: string,
          ids: string[],
          trigger: string,
        ) => Promise<void>;
      }
    ).assertDocumentsSubmittable(TENANT, ids, 'user');
  return { gate, store };
}

async function expectCooldownBlock(gate: () => Promise<void>) {
  await expect(gate()).rejects.toBeInstanceOf(ConflictException);
  try {
    await gate();
    throw new Error('expected a cooldown block');
  } catch (e) {
    return (e as ConflictException).getResponse() as { code: string };
  }
}

describe('submit gate is scoped per document', () => {
  const textA = payloadText('A');

  it("a cooldown on document A does not block document B", async () => {
    const { gate } = makeService([
      docRow({
        id: 'a',
        submitCooldownUntil: new Date(Date.now() + 5 * 60_000),
        submitCooldownPayloadHash: hashOf(textA),
      }),
      docRow({ id: 'b' }),
    ]);

    const blocked = await expectCooldownBlock(() => gate(['a']));
    expect(blocked.code).toBe('ETA_DUPLICATE_COOLDOWN');

    // The whole point: B is a different document and must go through.
    await expect(gate(['b'])).resolves.toBeUndefined();
  });

  it('auto-expires an elapsed window and clears the stored state', async () => {
    const { gate, store } = makeService([
      docRow({
        id: 'a',
        submitCooldownUntil: new Date(Date.now() - 1_000),
        submitCooldownPayloadHash: hashOf(textA),
        submitPendingRetrySubmissionId: 'sub-1',
      }),
    ]);

    await expect(gate(['a'])).resolves.toBeUndefined();
    expect(store.get('a')!.submitCooldownUntil).toBeNull();
    expect(store.get('a')!.submitCooldownPayloadHash).toBeNull();
    expect(store.get('a')!.submitPendingRetrySubmissionId).toBeNull();
  });

  it('does not block after the payload changed (different bytes to ETA)', async () => {
    const { gate, store } = makeService([
      docRow({
        id: 'a',
        submitCooldownUntil: new Date(Date.now() + 5 * 60_000),
        submitCooldownPayloadHash: hashOf(payloadText('OLD-BYTES')),
      }),
    ]);

    await expect(gate(['a'])).resolves.toBeUndefined();
    expect(store.get('a')!.submitCooldownUntil).toBeNull();
  });

  it('honours a fresh in-flight lock but not one stranded by a restart', async () => {
    const fresh = makeService([
      docRow({ id: 'a', submitInFlight: true, submitInFlightSince: new Date() }),
    ]);
    const blocked = await expectCooldownBlock(() => fresh.gate(['a']));
    expect(blocked.code).toBe('SUBMIT_IN_FLIGHT');

    const stale = makeService([
      docRow({
        id: 'a',
        submitInFlight: true,
        submitInFlightSince: new Date(Date.now() - IN_FLIGHT_STALE_MS - 1_000),
      }),
    ]);
    await expect(stale.gate(['a'])).resolves.toBeUndefined();
  });
});
