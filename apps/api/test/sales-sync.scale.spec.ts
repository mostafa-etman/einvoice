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
import { ETA_DOCUMENTS_SEARCH_PAGE_SIZE } from '../src/eta/eta-documents-search.client';
import { syncSearchWindows } from '../src/sync/eta-sync-collect';

const PAGE = ETA_DOCUMENTS_SEARCH_PAGE_SIZE;
const TOTAL = 1000;
const JUNE_MIDNIGHT = cairoDayStart('2026-06-01').toISOString();
const JUNE_END = cairoDayEnd('2026-06-01').toISOString();
const JUNE_NOON = '2026-06-15T12:00:00.000+02:00';
const SEPT_NOON = '2026-09-12T12:00:00.000+02:00';

type InvoiceRow = {
  uuid: string;
  internalId: string;
  dateTimeIssued: string;
};

function uuidAt(prefix: 'a' | 'b', i: number): string {
  return `${prefix}aaaaaaa-1111-4111-8111-${String(i).padStart(12, '0')}`;
}

function detailsFor(row: InvoiceRow) {
  return {
    uuid: row.uuid,
    internalId: row.internalId,
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: row.dateTimeIssued,
    issuer: { type: 'B', id: '123456789', name: 'Seller' },
    receiver: { type: 'B', id: '987654321', name: 'Buyer' },
    totalSalesAmount: '100.00',
    totalDiscountAmount: '0',
    netAmount: '100.00',
    totalAmount: '114.00',
    taxTotals: [{ taxType: 'T1', amount: '14.00' }],
    invoiceLines: [
      {
        description: `Item ${row.internalId} ${row.dateTimeIssued.slice(0, 7)}`,
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

function buildInvoices(): InvoiceRow[] {
  const rows: InvoiceRow[] = [];
  rows.push({
    uuid: uuidAt('a', 1),
    internalId: '2',
    dateTimeIssued: JUNE_MIDNIGHT,
  });
  rows.push({
    uuid: uuidAt('a', 2),
    internalId: '2',
    dateTimeIssued: JUNE_END,
  });
  for (let i = 3; i <= 500; i++) {
    rows.push({
      uuid: uuidAt('a', i),
      internalId: String((i % 40) + 1),
      dateTimeIssued: JUNE_NOON,
    });
  }
  for (let i = 1; i <= 500; i++) {
    rows.push({
      uuid: uuidAt('b', i),
      internalId: String((i % 40) + 1),
      dateTimeIssued: SEPT_NOON,
    });
  }
  return rows;
}

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sales_sync_scale_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!', name: 'Sync Owner' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Scale ${suffix}` })
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
  opts?: {
    failFrom?: Date;
    onDetails?: (uuid: string) => Promise<void> | void;
    onSearch?: (windowFrom: Date) => void;
  },
) {
  jest.spyOn(eta, 'getAccessToken').mockResolvedValue('tok');
  jest.spyOn(eta, 'getActiveEnvironment').mockResolvedValue('SANDBOX');
  jest.spyOn(eta, 'getApiBaseUrl').mockResolvedValue('https://eta.test');

  salesSync.setClientsForTests({
    search: {
      searchSent: async (
        _token: string,
        searchOpts: {
          continuationToken?: string;
          window: { from: Date; to: Date };
        },
      ) => {
        opts?.onSearch?.(searchOpts.window.from);
        if (
          opts?.failFrom &&
          searchOpts.window.from.getTime() >= opts.failFrom.getTime()
        ) {
          throw new Error('ETA window failed');
        }
        const inWindow = invoices.filter((row) => {
          const t = new Date(row.dateTimeIssued).getTime();
          return (
            t >= searchOpts.window.from.getTime() &&
            t <= searchOpts.window.to.getTime()
          );
        });
        const start =
          searchOpts.continuationToken &&
          searchOpts.continuationToken.startsWith('p')
            ? Number(searchOpts.continuationToken.slice(1)) * PAGE
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
        await opts?.onDetails?.(uuid);
        const row = invoices.find((r) => r.uuid === uuid);
        if (!row) throw new Error(`unknown uuid ${uuid}`);
        return detailsFor(row);
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
  mockOpts?: Parameters<typeof mockEtaClients>[3],
) {
  const salesSync = app.get(SalesSyncService);
  const eta = app.get(EtaService);
  const tenantPrisma = app.get(TenantPrismaService);
  mockEtaClients(salesSync, eta, invoices, mockOpts);
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
      },
    }),
  );
  const finished = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
    tx.issuedDocumentSyncRun.findFirst({ where: { id: run.id } }),
  );
  return { counters, stored, finished };
}

describe('Sales sync scale, windows, and concurrency', () => {
  const origDelay = process.env.ETA_SYNC_REQUEST_DELAY_MS;
  const origConcurrency = process.env.ETA_SYNC_DETAILS_CONCURRENCY;
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    process.env.ETA_SYNC_REQUEST_DELAY_MS = '0';
    process.env.ETA_SYNC_DETAILS_CONCURRENCY = '6';
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Sales sync scale');
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
    if (origConcurrency === undefined) {
      delete process.env.ETA_SYNC_DETAILS_CONCURRENCY;
    } else {
      process.env.ETA_SYNC_DETAILS_CONCURRENCY = origConcurrency;
    }
    if (app) await app.close();
  });

  it('keeps 30-day ETA windows (not a blind 7-day split)', () => {
    const windows = syncSearchWindows(
      cairoDayStart('2026-06-01'),
      cairoDayEnd('2026-09-12'),
    );
    expect(windows.length).toBeGreaterThanOrEqual(3);
    expect(windows.length).toBeLessThanOrEqual(12);
    const firstSpan =
      windows[0]!.to.getTime() - windows[0]!.from.getTime();
    expect(firstSpan).toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
    expect(firstSpan).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
  });

  it('imports 1000 invoices across pages/windows without merging duplicate numbers', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `n-${Date.now()}`);
    const invoices = buildInvoices();
    expect(invoices).toHaveLength(TOTAL);
    const searchWindows = new Set<number>();
    let searchPages = 0;
    const result = await executeRange(
      app,
      ctx,
      '2026-06-01',
      '2026-09-12',
      invoices,
      {
        onSearch: (from) => {
          searchWindows.add(from.getTime());
          searchPages += 1;
        },
      },
    );

    expect(result.counters.failedCount).toBe(0);
    expect(result.counters.fetchedCount).toBe(TOTAL);
    expect(result.counters.newCount).toBe(TOTAL);
    expect(result.finished?.status).toBe('SUCCEEDED');
    expect(result.stored).toHaveLength(TOTAL);
    expect(new Set(result.stored.map((d) => d.etaUuid)).size).toBe(TOTAL);
    expect(searchPages).toBeGreaterThanOrEqual(10);
    expect(searchWindows.size).toBeGreaterThanOrEqual(3);

    const numberTwo = result.stored.filter((d) => d.internalId === '2');
    expect(numberTwo.length).toBeGreaterThanOrEqual(2);
    const juneMidnight = result.stored.find(
      (d) => d.etaUuid === uuidAt('a', 1),
    );
    const juneEnd = result.stored.find((d) => d.etaUuid === uuidAt('a', 2));
    expect(juneMidnight?.issueDateTime.getTime()).toBe(
      new Date(JUNE_MIDNIGHT).getTime(),
    );
    expect(juneEnd?.issueDateTime.getTime()).toBe(new Date(JUNE_END).getTime());

    const septTwo = result.stored.filter(
      (d) =>
        d.internalId === '2' &&
        d.issueDateTime.getTime() === new Date(SEPT_NOON).getTime(),
    );
    const juneTwos = result.stored.filter(
      (d) =>
        d.internalId === '2' &&
        d.issueDateTime.getTime() !== new Date(SEPT_NOON).getTime(),
    );
    expect(juneTwos.length).toBeGreaterThanOrEqual(1);
    expect(septTwo.length).toBeGreaterThanOrEqual(1);

    const again = await executeRange(
      app,
      ctx,
      '2026-06-01',
      '2026-09-12',
      invoices,
    );
    expect(again.counters.newCount).toBe(0);
    expect(again.stored).toHaveLength(TOTAL);
    expect(new Set(again.stored.map((d) => d.etaUuid)).size).toBe(TOTAL);
    expect(again.finished?.status).toBe('SUCCEEDED');
  }, 300000);

  it('caps details concurrency and keeps already-saved windows on later failure', async () => {
    if (!dbAvailable) return;
    process.env.ETA_SYNC_DETAILS_CONCURRENCY = '4';
    const ctx = await ownerCtx(app, `p-${Date.now()}`);
    const invoices: InvoiceRow[] = [
      ...Array.from({ length: 12 }, (_, i) => ({
        uuid: uuidAt('a', i + 1),
        internalId: '2',
        dateTimeIssued: JUNE_NOON,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        uuid: uuidAt('b', i + 1),
        internalId: '2',
        dateTimeIssued: SEPT_NOON,
      })),
    ];

    let inFlight = 0;
    let peak = 0;
    const first = await executeRange(
      app,
      ctx,
      '2026-06-01',
      '2026-09-12',
      invoices,
      {
        failFrom: cairoDayStart('2026-07-01'),
        onDetails: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
        },
      },
    );

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(first.finished?.status).toBe('FAILED');
    expect(first.stored).toHaveLength(12);
    expect(first.stored.every((d) => d.internalId === '2')).toBe(true);
    expect(first.stored.some((d) => d.etaUuid === uuidAt('b', 1))).toBe(false);
    expect(first.finished?.errorSummary).toMatch(/partial|failed/i);

    const resumed = await executeRange(
      app,
      ctx,
      '2026-06-01',
      '2026-09-12',
      invoices,
    );
    expect(resumed.finished?.status).toBe('SUCCEEDED');
    expect(resumed.stored).toHaveLength(17);
    expect(new Set(resumed.stored.map((d) => d.etaUuid)).size).toBe(17);
  }, 180000);
});
