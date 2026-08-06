import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { ReportsService } from '../src/reports/reports.service';
import { cairoDayBounds } from '../src/reports/report-filters';
import { sub } from '@einvoice/eta-core';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `reports_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Reports ${suffix}` })
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
    branchId: branches.body[0].id as string,
  };
}

function issuedBase(
  tenantId: string,
  branchId: string,
  internalId: string,
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE',
  totalAmount: string,
  taxAmount: string,
  issueDateTime: Date,
) {
  return {
    tenantId,
    branchId,
    kind,
    status: 'VALID' as const,
    currencyCode: 'EGP',
    issueDateTime,
    internalId,
    version: 1,
    etaDocumentType: kind === 'INVOICE' ? 'i' : kind === 'CREDIT_NOTE' ? 'c' : 'd',
    etaDocumentTypeVersion: '1.0',
    typeVersionFetchedAt: new Date(),
    issuerSnapshotJson: { type: 'B', id: '123' },
    etaPayloadJson: { dummy: true },
    totalAmount,
    taxTotalsJson: [{ taxType: 'T1', amount: taxAmount }],
    receiverId: 'recv-1',
    receiverName: 'Buyer Co',
  };
}

describe('Reports netting + NET VAT (acceptance)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Reports netting');
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
    if (app) await app.close();
  });

  it('S1 sales = invoices − credits + debits; C1 = S4 − P3', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);
    const reports = app.get(ReportsService);
    const day = new Date('2026-08-05T12:00:00+02:00');
    const { start, end } = cairoDayBounds('2026-08-01', '2026-08-06');

    await tenantPrisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.document.create({
        data: issuedBase(
          ctx.tenantId,
          ctx.branchId,
          `INV-${Date.now()}`,
          'INVOICE',
          '1000.00',
          '140.00',
          day,
        ),
      });
      await tx.document.create({
        data: issuedBase(
          ctx.tenantId,
          ctx.branchId,
          `CN-${Date.now()}`,
          'CREDIT_NOTE',
          '200.00',
          '28.00',
          day,
        ),
      });
      await tx.document.create({
        data: issuedBase(
          ctx.tenantId,
          ctx.branchId,
          `DN-${Date.now()}`,
          'DEBIT_NOTE',
          '50.00',
          '7.00',
          day,
        ),
      });
      // Cancelled must not count
      await tx.document.create({
        data: {
          ...issuedBase(
            ctx.tenantId,
            ctx.branchId,
            `CX-${Date.now()}`,
            'INVOICE',
            '999.00',
            '99.00',
            day,
          ),
          status: 'CANCELLED',
        },
      });
      await tx.receivedDocument.create({
        data: {
          tenantId: ctx.tenantId,
          documentUuid: `rd-inv-${Date.now()}`,
          etaDocumentType: 'i',
          kind: 'PURCHASE_INVOICE',
          etaStatus: 'Valid',
          buyerDecision: 'NONE',
          dateTimeIssued: day,
          currency: 'EGP',
          totalAmount: '500.00',
          branchId: ctx.branchId,
          issuerId: 'sup-1',
          issuerName: 'Supplier',
          rawSummaryJson: { taxTotals: [{ taxType: 'T1', amount: '70.00' }] },
          lastSyncedAt: new Date(),
        },
      });
      await tx.receivedDocument.create({
        data: {
          tenantId: ctx.tenantId,
          documentUuid: `rd-ret-${Date.now()}`,
          etaDocumentType: 'c',
          kind: 'PURCHASE_RETURN',
          etaStatus: 'Valid',
          buyerDecision: 'NONE',
          dateTimeIssued: day,
          currency: 'EGP',
          totalAmount: '100.00',
          branchId: ctx.branchId,
          issuerId: 'sup-1',
          issuerName: 'Supplier',
          rawSummaryJson: { taxTotals: [{ taxType: 'T1', amount: '14.00' }] },
          lastSyncedAt: new Date(),
        },
      });
      // T4 on sales — must not enter NET VAT
      await tx.document.create({
        data: {
          ...issuedBase(
            ctx.tenantId,
            ctx.branchId,
            `T4-${Date.now()}`,
            'INVOICE',
            '100.00',
            '0.00',
            day,
          ),
          totalAmount: '100.00',
          taxTotalsJson: [
            { taxType: 'T1', amount: '14.00' },
            { taxType: 'T4', amount: '5.00' },
          ],
        },
      });
    });

    const filters = {
      from: '2026-08-01',
      to: '2026-08-06',
      perCurrency: false,
      includeNonFinancialStatuses: false,
      showGross: true,
      grain: 'day' as const,
      perBranch: true,
      limit: 50,
      rangeStart: start,
      rangeEnd: end,
    };

    const s1 = await reports.run({
      tenantId: ctx.tenantId,
      reportId: 'S1',
      filters,
    });
    // 1000 - 200 + 50 + 100 (T4 invoice) = 950
    expect(s1.summary.net).toBe('950.00');

    const s4 = await reports.run({
      tenantId: ctx.tenantId,
      reportId: 'S4',
      filters,
    });
    // T1: 140 - 28 + 7 + 14 = 133
    expect(s4.summary.outputVat).toBe('133.00');
    expect(s4.summary.withholding).toBe('5.00');

    const p3 = await reports.run({
      tenantId: ctx.tenantId,
      reportId: 'P3',
      filters,
    });
    // 70 - 14 = 56
    expect(p3.summary.inputVat).toBe('56.00');

    const c1 = await reports.run({
      tenantId: ctx.tenantId,
      reportId: 'C1',
      filters,
    });
    expect(c1.summary.outputVat).toBe(s4.summary.outputVat);
    expect(c1.summary.inputVat).toBe(p3.summary.inputVat);
    expect(c1.summary.netVat).toBe(sub(s4.summary.outputVat, p3.summary.inputVat));
    expect(c1.summary.netVat).toBe('77.00');
    expect(c1.summary.position).toBe('payable');
    expect(c1.summary.withholdingSeparate.output).toBe('5.00');

    const http = await request(app.getHttpServer())
      .get('/reports/C1')
      .query({ from: '2026-08-01', to: '2026-08-06', perBranch: 'true' })
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(http.body.summary.netVat).toBe('77.00');
  });

  it('does not leak other tenant data', async () => {
    if (!dbAvailable) return;
    const a = await ownerCtx(app, `a-${Date.now()}`);
    const b = await ownerCtx(app, `b-${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);
    const day = new Date('2026-08-05T12:00:00+02:00');
    await tenantPrisma.withTenant(a.tenantId, (tx) =>
      tx.document.create({
        data: issuedBase(
          a.tenantId,
          a.branchId,
          `A-${Date.now()}`,
          'INVOICE',
          '777.00',
          '10.00',
          day,
        ),
      }),
    );
    const res = await request(app.getHttpServer())
      .get('/reports/S1')
      .query({ from: '2026-08-01', to: '2026-08-06' })
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .expect(200);
    expect(res.body.summary.net).toBe('0.00');
  });
});
