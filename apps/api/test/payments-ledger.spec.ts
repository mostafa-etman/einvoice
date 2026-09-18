import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

describe('Manual payments ledger', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Manual payments ledger');
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

  it('tracks operator-entered payments without exposing the ledger to tenants', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const password = 'Password123!';

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `pay_${t}@example.com`, password, name: 'Pay Owner' })
      .expect(201);

    const tenant = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${owner.body.accessToken}`)
        .send({ name: `Pay Co ${t}`, planCode: 'BASIC' })
        .expect(201)
    ).body;
    const token = tenant.accessToken ?? owner.body.accessToken;

    await request(app.getHttpServer())
      .get('/platform-admin/payments')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: owner.body.user.id },
      data: { isPlatformOperator: true },
    });

    const accountId = (
      await request(app.getHttpServer())
        .get(`/platform-admin/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.accountId as string;
    expect(accountId).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/platform-admin/payments/${accountId}/billing`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amountDueEgp: 400,
        dueDate: '2020-01-01T00:00:00.000Z',
      })
      .expect(200);

    const recorded = await request(app.getHttpServer())
      .post(`/platform-admin/payments/${accountId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amountEgp: 150,
        purpose: 'PLAN',
        method: 'WhatsApp / Vodafone Cash',
        reference: `REF-${t}`,
        notes: 'First installment',
        paidAt: '2026-09-01T00:00:00.000Z',
      })
      .expect(201);
    expect(recorded.body.amountDueEgp).toBe(400);
    expect(recorded.body.amountPaidEgp).toBe(150);
    expect(recorded.body.status).toBe('OVERDUE');
    expect(recorded.body.payments).toHaveLength(1);

    const listed = await request(app.getHttpServer())
      .get('/platform-admin/payments')
      .query({ status: 'overdue' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body.items.some((row: { accountId: string }) => row.accountId === accountId)).toBe(
      true,
    );
    expect(listed.body.summary.overdueCount).toBeGreaterThanOrEqual(1);

    const tenantPrisma = app.get(TenantPrismaService);
    const hidden = await tenantPrisma.withTenant(tenant.id, (tx) =>
      tx.accountPayment.findMany({ where: { accountId } }),
    );
    expect(hidden).toEqual([]);
  });
});
