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

const TOTAL = 250;
const PAGE = 100;
const DAY = '2026-09-12';

function uuidAt(i: number): string {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`;
}

function detailsFor(i: number, issuedAt: string) {
  const uuid = uuidAt(i);
  return {
    uuid,
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
        description: 'Item',
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

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sales_sync_page_${suffix}@example.com`;
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

describe('Sales sync pagination and Cairo day bounds', () => {
  const origDelay = process.env.ETA_SYNC_REQUEST_DELAY_MS;
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    process.env.ETA_SYNC_REQUEST_DELAY_MS = '0';
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Sales sync pagination');
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

  it('synchronizes 250 same-day sales invoices across 3 search pages with no duplicates', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const salesSync = app.get(SalesSyncService);
    const eta = app.get(EtaService);
    const tenantPrisma = app.get(TenantPrismaService);

    jest.spyOn(eta, 'getAccessToken').mockResolvedValue('tok');
    jest.spyOn(eta, 'getActiveEnvironment').mockResolvedValue('SANDBOX');
    jest.spyOn(eta, 'getApiBaseUrl').mockResolvedValue('https://eta.test');

    const issuedAt = (i: number) => {
      if (i === 1) return '2026-09-12T00:00:00.000+02:00';
      if (i === TOTAL) return '2026-09-12T23:59:00.000+02:00';
      return '2026-09-12T12:00:00.000+02:00';
    };

    const rows = Array.from({ length: TOTAL }, (_, idx) => {
      const i = idx + 1;
      return {
        uuid: uuidAt(i),
        internalId: `S-${String(i).padStart(3, '0')}`,
        documentType: 'I',
        status: 'Valid',
        dateTimeIssued: issuedAt(i),
      };
    });

    const tokens: Array<string | undefined> = [];
    salesSync.setClientsForTests({
      search: {
        searchSent: async (_token: string, opts: { continuationToken?: string }) => {
          tokens.push(opts.continuationToken);
          const start =
            opts.continuationToken === 'p2'
              ? PAGE
              : opts.continuationToken === 'p3'
                ? PAGE * 2
                : 0;
          const slice = rows.slice(start, start + PAGE);
          const next =
            start + PAGE < TOTAL ? (start === 0 ? 'p2' : 'p3') : null;
          return { result: slice, continuationToken: next, raw: {} };
        },
      } as never,
      details: {
        getDetails: async (_token: string, uuid: string) => {
          const i = rows.findIndex((r) => r.uuid === uuid) + 1;
          return detailsFor(i, issuedAt(i));
        },
      } as never,
    });

    const range = {
      from: cairoDayStart(DAY),
      to: cairoDayEnd(DAY),
    };
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

    const counters = await salesSync.executeRun(
      ctx.tenantId,
      run.id,
      ctx.userId,
      range,
    );

    expect(tokens).toEqual([undefined, 'p2', 'p3']);
    expect(counters.fetchedCount).toBe(TOTAL);
    expect(counters.newCount).toBe(TOTAL);
    expect(counters.failedCount).toBe(0);

    const stored = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.findMany({
        where: { tenantId: ctx.tenantId, origin: 'ETA_SYNC' },
        select: { etaUuid: true, internalId: true, issueDateTime: true },
        orderBy: { internalId: 'asc' },
      }),
    );
    expect(stored).toHaveLength(TOTAL);
    expect(new Set(stored.map((d) => d.etaUuid)).size).toBe(TOTAL);
    expect(stored.some((d) => d.internalId === 'S-001')).toBe(true);
    expect(stored.some((d) => d.internalId === `S-${TOTAL}`)).toBe(true);

    const min = Math.min(...stored.map((d) => d.issueDateTime.getTime()));
    const max = Math.max(...stored.map((d) => d.issueDateTime.getTime()));
    expect(min).toBe(new Date('2026-09-12T00:00:00.000+02:00').getTime());
    expect(max).toBe(new Date('2026-09-12T23:59:00.000+02:00').getTime());

    const other = await ownerCtx(app, `iso-${Date.now()}`);
    const leaked = await tenantPrisma.withTenant(other.tenantId, (tx) =>
      tx.document.count({
        where: { tenantId: other.tenantId, origin: 'ETA_SYNC' },
      }),
    );
    expect(leaked).toBe(0);

    const finished = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.issuedDocumentSyncRun.findFirst({ where: { id: run.id } }),
    );
    expect(finished?.status).toBe('SUCCEEDED');
  }, 120000);
});
