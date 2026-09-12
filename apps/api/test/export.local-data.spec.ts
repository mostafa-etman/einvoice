import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { ExportsService } from '../src/exports/exports.service';
import {
  ISSUED_DOCUMENT_TYPES,
  RECEIVED_DOCUMENT_TYPES,
} from '../src/exports/local-export-scope';

const SALE_ID = 'SALE-FIX-1';
const PURCHASE_ID = 'PURCHASE-FIX-1';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `export_data_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!', name: 'Export Owner' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Export ${suffix}` })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenantId = tenant.body.id as string;
  await request(app.getHttpServer())
    .post('/currencies')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ currencyCode: 'EGP', isDefault: true })
    .expect(201);
  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  return {
    token,
    tenantId,
    userId: reg.body.user.id as string,
    branchId: branches.body[0].id as string,
  };
}

describe('Local export sales/purchases data', () => {
  let app: INestApplication;
  let dbAvailable = true;
  let ctx: Awaited<ReturnType<typeof ownerCtx>>;
  let exportsService: ExportsService;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Local export sales/purchases data');
      return;
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    exportsService = app.get(ExportsService);
    ctx = await ownerCtx(app, String(Date.now()));
    const tenantPrisma = app.get(TenantPrismaService);
    const issuedAt = new Date('2026-08-05T10:00:00.000+02:00');
    await tenantPrisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.document.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          kind: 'INVOICE',
          status: 'VALID',
          currencyCode: 'EGP',
          issueDateTime: issuedAt,
          internalId: SALE_ID,
          version: 1,
          etaDocumentType: 'i',
          etaDocumentTypeVersion: '1.0',
          typeVersionFetchedAt: new Date(),
          issuerSnapshotJson: { type: 'B', id: '123' },
          etaPayloadJson: { dummy: true },
          totalAmount: '100.00',
          netAmount: '87.72',
          receiverName: 'Buyer Fixture',
        },
      });
      await tx.receivedDocument.create({
        data: {
          tenantId: ctx.tenantId,
          documentUuid: `rd-${Date.now()}`,
          etaDocumentType: 'i',
          kind: 'PURCHASE_INVOICE',
          etaStatus: 'Valid',
          buyerDecision: 'NONE',
          dateTimeIssued: issuedAt,
          currency: 'EGP',
          totalAmount: '50.00',
          netAmount: '43.86',
          branchId: ctx.branchId,
          issuerName: 'Supplier Fixture',
          internalId: PURCHASE_ID,
          rawSummaryJson: {},
          lastSyncedAt: new Date(),
        },
      });
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function runExport(
    documentTypes: string[] | undefined,
    format: 'CSV' | 'XLSX' | 'PDF',
  ) {
    const job = await exportsService.createLocalExport({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      formats: [format],
      filters: { documentTypes },
    });
    await exportsService.processLocalExport(ctx.tenantId, job.id);
    return exportsService.download(ctx.tenantId, job.id, format.toLowerCase());
  }

  function csvText(buf: Buffer) {
    return buf.toString('utf8');
  }

  function xlsxText(buf: Buffer) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    return XLSX.utils.sheet_to_csv(sheet);
  }

  function pdfText(buf: Buffer) {
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    return buf.toString('utf8');
  }

  const cases: Array<{
    name: string;
    types: string[] | undefined;
    expectSale: boolean;
    expectPurchase: boolean;
  }> = [
    {
      name: 'Sales',
      types: [...ISSUED_DOCUMENT_TYPES],
      expectSale: true,
      expectPurchase: false,
    },
    {
      name: 'Purchases',
      types: [...RECEIVED_DOCUMENT_TYPES],
      expectSale: false,
      expectPurchase: true,
    },
    {
      name: 'All',
      types: [...ISSUED_DOCUMENT_TYPES, ...RECEIVED_DOCUMENT_TYPES],
      expectSale: true,
      expectPurchase: true,
    },
  ];

  for (const scope of cases) {
    for (const format of ['CSV', 'XLSX', 'PDF'] as const) {
      it(`${scope.name} + ${format} contains matching fixture rows`, async () => {
        if (!dbAvailable) return;
        const file = await runExport(scope.types, format);
        expect(file.buffer.byteLength).toBeGreaterThan(10);
        const text =
          format === 'CSV'
            ? csvText(file.buffer)
            : format === 'XLSX'
              ? xlsxText(file.buffer)
              : pdfText(file.buffer);
        if (scope.expectSale) {
          expect(text).toContain(SALE_ID);
        } else {
          expect(text).not.toContain(SALE_ID);
        }
        if (scope.expectPurchase) {
          expect(text).toContain(PURCHASE_ID);
        } else {
          expect(text).not.toContain(PURCHASE_ID);
        }
        if (format === 'CSV') {
          expect(text).toContain('internalId');
          expect(text).toContain('side');
        }
      });
    }
  }

  it('HTTP download returns the CSV bytes for an All export', async () => {
    if (!dbAvailable) return;
    const job = await exportsService.createLocalExport({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      formats: ['CSV'],
      filters: {
        documentTypes: [...ISSUED_DOCUMENT_TYPES, ...RECEIVED_DOCUMENT_TYPES],
      },
    });
    await exportsService.processLocalExport(ctx.tenantId, job.id);
    const res = await request(app.getHttpServer())
      .get(`/exports/jobs/${job.id}/download?format=csv`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c) => chunks.push(Buffer.from(c)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const body = res.body as Buffer;
    const text = body.toString('utf8');
    expect(text).toContain(SALE_ID);
    expect(text).toContain(PURCHASE_ID);
  });

  it('keeps Cairo-morning documents when from is a UTC-midnight date ISO', async () => {
    if (!dbAvailable) return;
    const job = await exportsService.createLocalExport({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      formats: ['CSV'],
      filters: {
        from: '2026-08-05T00:00:00.000Z',
        to: '2026-08-05T23:59:59.999+02:00',
        documentTypes: [...ISSUED_DOCUMENT_TYPES, ...RECEIVED_DOCUMENT_TYPES],
      },
    });
    await exportsService.processLocalExport(ctx.tenantId, job.id);
    const file = await exportsService.download(ctx.tenantId, job.id, 'csv');
    const text = file.buffer.toString('utf8');
    expect(text).toContain(SALE_ID);
    expect(text).toContain(PURCHASE_ID);
  });
});
