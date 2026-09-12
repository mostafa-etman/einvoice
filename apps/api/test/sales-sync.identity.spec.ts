import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { SalesSyncService } from '../src/documents/sales-sync.service';
import { EtaService } from '../src/eta/eta.service';
import { cairoDayEnd, cairoDayStart } from '../src/time/cairo-day';

const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2';
const JUNE_ISSUED = '2026-06-15T12:00:00.000+03:00';
const SEPT_ISSUED = '2026-09-12T12:00:00.000+03:00';
const PAGE = 100;

function detailsFor(uuid: string, issuedAt: string, internalId: string) {
  return {
    uuid,
    internalId,
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: issuedAt,
    issuer: { type: 'B', id: '123456789', name: 'Seller' },
    receiver: { type: 'B', id: '987654321', name: 'Buyer' },
    totalSalesAmount: '100.00',
    totalDiscountAmount: '0',
    netAmount: '100.00',
    totalAmount: '114.00',
    taxTotals: [{ taxType: 'T1', amount: '14.00' }],
    invoiceLines: [
      {
        description: `Item ${internalId} ${issuedAt.slice(0, 7)}`,
        itemType: 'EGS',
        itemCode: 'EG-1',
        unitType: 'EA',
        quantity: '1',
        unitValue: { currencySold: 'EGP', amountEGP: 100 },
        salesTotal: '100.00',
        netTotal: '100.00',
        total: '114.00',
        taxableItems: [
          { taxType: 'T1', subType: 'V001', rate: '14', amount: '14.00' },
        ],
      },
    ],
  };
}

type InvoiceRow = {
  uuid: string;
  internalId: string;
  dateTimeIssued: string;
};

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sales_sync_id_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!', name: 'Sync Owner' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Sync ${suffix}` })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenantId = tenant.body.id as string;
  await request(app.getHttpServer())
    .post('/currencies')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ currencyCode: 'EGP', isDefault: true })
    .expect(201);
  await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  return { token, tenantId, userId: reg.body.user.id as string };
}

function mockEtaClients(
  salesSync: SalesSyncService,
  eta: EtaService,
  invoices: InvoiceRow[],
) {
  jest.spyOn(eta, 'getAccessToken').mockResolvedValue('tok');
  jest.spyOn(eta, 'getActiveEnvironment').mockResolvedValue('SANDBOX');
  jest.spyOn(eta, 'getApiBaseUrl').mockResolvedValue('https://eta.test');

  salesSync.setClientsForTests({
    search: {
      searchSent: async (
        _token: string,
        opts: {
          continuationToken?: string;
          window: { from: Date; to: Date };
        },
      ) => {
        const inWindow = invoices.filter((row) => {
          const t = new Date(row.dateTimeIssued).getTime();
          return t >= opts.window.from.getTime() && t <= opts.window.to.getTime();
        });
        const start =
          opts.continuationToken && opts.continuationToken.startsWith('p')
            ? Number(opts.continuationToken.slice(1)) * PAGE
            : 0;
        const slice = inWindow.slice(start, start + PAGE);
        const next =
          start + PAGE < inWindow.length
            ? `p${Math.floor(start / PAGE) + 1}`
            : null;
        return { result: slice, continuationToken: next, raw: {} };
      },
    } as never,
    details: {
      getDetails: async (_token: string, uuid: string) => {
        const row = invoices.find((r) => r.uuid === uuid);
        if (!row) throw new Error(`unknown uuid ${uuid}`);
        return detailsFor(row.uuid, row.dateTimeIssued, row.internalId);
      },
    } as never,
  });
}

async function executeRange(
  app: INestApplication,
  ctx: { tenantId: string; userId: string },
  fromDay: string,
  toDay: string,
  invoices: InvoiceRow[],
) {
  const salesSync = app.get(SalesSyncService);
  const eta = app.get(EtaService);
  const tenantPrisma = app.get(TenantPrismaService);
  mockEtaClients(salesSync, eta, invoices);
  const run = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
    tx.issuedDocumentSyncRun.create({
      data: {
        tenantId: ctx.tenantId,
        trigger: 'MANUAL',
        status: 'PENDING',
        triggeredByUserId: ctx.userId,
      },
    }),
  );
  const counters = await salesSync.executeRun(ctx.tenantId, run.id, ctx.userId, {
    from: cairoDayStart(fromDay),
    to: cairoDayEnd(toDay),
  });
  const stored = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
    tx.document.findMany({
      where: { tenantId: ctx.tenantId, origin: 'ETA_SYNC' },
      select: {
        etaUuid: true,
        internalId: true,
        issueDateTime: true,
        lines: { select: { description: true }, take: 1 },
      },
      orderBy: { issueDateTime: 'asc' },
    }),
  );
  return { counters, stored };
}

describe('Sales sync document identity (ETA UUID, not invoice number)', () => {
  const origDelay = process.env.ETA_SYNC_REQUEST_DELAY_MS;
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    process.env.ETA_SYNC_REQUEST_DELAY_MS = '0';
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Sales sync identity');
      return;
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    if (origDelay === undefined) delete process.env.ETA_SYNC_REQUEST_DELAY_MS;
    else process.env.ETA_SYNC_REQUEST_DELAY_MS = origDelay;
    if (app) await app.close();
  });

  it('Test A+D: June #2 UUID A and September #2 UUID B stay two documents', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `a-${Date.now()}`);
    const june: InvoiceRow = {
      uuid: UUID_A,
      internalId: '2',
      dateTimeIssued: JUNE_ISSUED,
    };
    const sept: InvoiceRow = {
      uuid: UUID_B,
      internalId: '2',
      dateTimeIssued: SEPT_ISSUED,
    };

    const afterJune = await executeRange(app, ctx, '2026-06-15', '2026-06-15', [
      june,
    ]);
    expect(afterJune.counters.failedCount).toBe(0);
    expect(afterJune.stored).toHaveLength(1);
    expect(afterJune.stored[0]?.etaUuid).toBe(UUID_A);
    expect(afterJune.stored[0]?.internalId).toBe('2');
    const juneIssued = afterJune.stored[0]!.issueDateTime.getTime();

    const afterSept = await executeRange(app, ctx, '2026-09-12', '2026-09-12', [
      sept,
    ]);
    expect(afterSept.counters.failedCount).toBe(0);
    expect(afterSept.stored).toHaveLength(2);

    const byUuid = new Map(afterSept.stored.map((d) => [d.etaUuid, d]));
    expect(byUuid.get(UUID_A)?.internalId).toBe('2');
    expect(byUuid.get(UUID_B)?.internalId).toBe('2');
    expect(byUuid.get(UUID_A)?.issueDateTime.getTime()).toBe(juneIssued);
    expect(byUuid.get(UUID_B)?.issueDateTime.getTime()).toBe(
      new Date(SEPT_ISSUED).getTime(),
    );
    expect(byUuid.get(UUID_A)?.etaUuid).toBe(UUID_A);
    expect(byUuid.get(UUID_B)?.etaUuid).toBe(UUID_B);
    expect(byUuid.get(UUID_A)?.lines[0]?.description).toContain('2026-06');
    expect(byUuid.get(UUID_B)?.lines[0]?.description).toContain('2026-09');
  }, 120000);

  it('Test B: syncing UUID A twice updates the same document', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `b-${Date.now()}`);
    const june: InvoiceRow = {
      uuid: UUID_A,
      internalId: '2',
      dateTimeIssued: JUNE_ISSUED,
    };
    await executeRange(app, ctx, '2026-06-15', '2026-06-15', [june]);
    const second = await executeRange(app, ctx, '2026-06-15', '2026-06-15', [
      june,
    ]);
    expect(second.counters.newCount).toBe(0);
    expect(second.stored).toHaveLength(1);
    expect(second.stored[0]?.etaUuid).toBe(UUID_A);
    expect(second.stored[0]?.internalId).toBe('2');
  }, 120000);

  it('Test C: syncing UUID B twice updates the same document', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `c-${Date.now()}`);
    const sept: InvoiceRow = {
      uuid: UUID_B,
      internalId: '2',
      dateTimeIssued: SEPT_ISSUED,
    };
    await executeRange(app, ctx, '2026-09-12', '2026-09-12', [sept]);
    const second = await executeRange(app, ctx, '2026-09-12', '2026-09-12', [
      sept,
    ]);
    expect(second.counters.newCount).toBe(0);
    expect(second.stored).toHaveLength(1);
    expect(second.stored[0]?.etaUuid).toBe(UUID_B);
    expect(second.stored[0]?.internalId).toBe('2');
  }, 120000);

  it('Test E: tenants may share invoice numbers and ETA identifiers independently', async () => {
    if (!dbAvailable) return;
    const stamp = Date.now();
    const tenant1 = await ownerCtx(app, `e1-${stamp}`);
    const tenant2 = await ownerCtx(app, `e2-${stamp}`);
    const june: InvoiceRow = {
      uuid: UUID_A,
      internalId: '2',
      dateTimeIssued: JUNE_ISSUED,
    };
    const sept: InvoiceRow = {
      uuid: UUID_B,
      internalId: '2',
      dateTimeIssued: SEPT_ISSUED,
    };

    const t1 = await executeRange(app, tenant1, '2026-06-15', '2026-06-15', [
      june,
    ]);
    const t2 = await executeRange(app, tenant2, '2026-06-15', '2026-09-12', [
      june,
      sept,
    ]);

    expect(t1.stored).toHaveLength(1);
    expect(t1.stored[0]?.etaUuid).toBe(UUID_A);
    expect(t1.stored[0]?.internalId).toBe('2');

    expect(t2.stored).toHaveLength(2);
    expect(new Set(t2.stored.map((d) => d.etaUuid))).toEqual(
      new Set([UUID_A, UUID_B]),
    );
    expect(t2.stored.every((d) => d.internalId === '2')).toBe(true);

    const tenantPrisma = app.get(TenantPrismaService);
    const leaked = await tenantPrisma.withTenant(tenant1.tenantId, (tx) =>
      tx.document.count({
        where: { tenantId: tenant1.tenantId, etaUuid: UUID_B },
      }),
    );
    expect(leaked).toBe(0);
  }, 120000);

  it('Test F: multi-page sync keeps repeated invoice numbers across periods', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `f-${Date.now()}`);
    const juneRows: InvoiceRow[] = Array.from({ length: 20 }, (_, i) => ({
      uuid: `aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
      internalId: String((i % 10) + 1),
      dateTimeIssued: JUNE_ISSUED,
    }));
    const septRows: InvoiceRow[] = Array.from({ length: 110 }, (_, i) => ({
      uuid: `bbbbbbbb-2222-4222-8222-${String(i + 1).padStart(12, '0')}`,
      internalId: String((i % 10) + 1),
      dateTimeIssued: SEPT_ISSUED,
    }));
    const invoices = [...juneRows, ...septRows];
    const result = await executeRange(
      app,
      ctx,
      '2026-06-15',
      '2026-09-12',
      invoices,
    );

    expect(result.counters.failedCount).toBe(0);
    expect(result.counters.fetchedCount).toBe(130);
    expect(result.stored).toHaveLength(130);
    expect(new Set(result.stored.map((d) => d.etaUuid)).size).toBe(130);
    expect(result.stored.filter((d) => d.internalId === '2')).toHaveLength(13);
    expect(
      result.stored.filter(
        (d) => d.issueDateTime.getTime() === new Date(JUNE_ISSUED).getTime(),
      ),
    ).toHaveLength(20);
    expect(
      result.stored.filter(
        (d) => d.issueDateTime.getTime() === new Date(SEPT_ISSUED).getTime(),
      ),
    ).toHaveLength(110);
  }, 180000);
});
