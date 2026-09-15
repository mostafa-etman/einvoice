import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PointsService } from '../src/billing/points.service';
import { InsufficientPointsHttpException } from '../src/billing/points-errors';

async function registerUser(app: INestApplication, suffix: string) {
  const email = `acct_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    userId: reg.body.user.id as string,
  };
}

describe('Account-level subscription and shared points', () => {
  let app: INestApplication;
  let dbAvailable = true;
  const prev = process.env.SIGNUP_AUTO_APPROVE;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Account-level billing');
      return;
    }
    process.env.SIGNUP_AUTO_APPROVE = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    if (prev === undefined) delete process.env.SIGNUP_AUTO_APPROVE;
    else process.env.SIGNUP_AUTO_APPROVE = prev;
    if (app) await app.close();
  });

  it('shares one plan and one points pool across companies the owner creates', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const user = await registerUser(app, String(t));
    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });

    const first = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Parent ${t}` })
      .expect(201);

    const assigned = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${first.body.id}/plan`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ planCode: 'BASIC', extraCompanies: 3, extraUsers: 2, reason: 'account-share' });
    expect([200, 201]).toContain(assigned.status);

    const second = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Child ${t}` })
      .expect(201);

    expect(second.body.accountId).toBe(first.body.accountId ?? assigned.body.accountId);

    const parentSub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', first.body.id)
      .expect(200);
    const childSub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', second.body.id)
      .expect(200);

    expect(parentSub.body.plan.code).toBe('BASIC');
    expect(childSub.body.plan.code).toBe('BASIC');
    expect(childSub.body.plan.code).toBe(parentSub.body.plan.code);
    expect(childSub.body.pointsBalance).toBe(parentSub.body.pointsBalance);

    const parentRow = await prisma.tenant.findUniqueOrThrow({
      where: { id: first.body.id },
      select: { accountId: true },
    });
    const childRow = await prisma.tenant.findUniqueOrThrow({
      where: { id: second.body.id },
      select: { accountId: true },
    });
    expect(childRow.accountId).toBe(parentRow.accountId);
    const tenantPrisma = app.get(TenantPrismaService);
    const subCount = await tenantPrisma.withTenant(first.body.id, (tx) =>
      tx.subscription.count({ where: { accountId: parentRow.accountId } }),
    );
    expect(subCount).toBe(1);

    for (const tenantId of [first.body.id, second.body.id] as string[]) {
      await request(app.getHttpServer())
        .put(`/platform-admin/tenants/${tenantId}/document-costs`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ items: [{ documentKind: 'INVOICE', points: 4 }, { documentKind: 'RECEIPT', points: 2 }] })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${first.body.id}/points`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ delta: 20, note: 'shared pool' });

    const before = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${second.body.id}/points`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    const points = app.get(PointsService);
    const fromChild = await tenantPrisma.withTenant(second.body.id, (tx) =>
      points.consumeForSendInTx(tx, {
        tenantId: second.body.id,
        kinds: ['INVOICE'],
        documentIds: ['00000000-0000-4000-8000-000000000010'],
        actorUserId: user.userId,
      }),
    );
    expect(fromChild.total).toBe(4);

    const afterParent = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${first.body.id}/points`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const afterChild = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${second.body.id}/points`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(afterParent.body.pointsBalance).toBe(before.body.pointsBalance - 4);
    expect(afterChild.body.pointsBalance).toBe(afterParent.body.pointsBalance);

    const fromParent = await tenantPrisma.withTenant(first.body.id, (tx) =>
      points.consumeForSendInTx(tx, {
        tenantId: first.body.id,
        kinds: ['RECEIPT'],
        documentIds: ['00000000-0000-4000-8000-000000000011'],
        actorUserId: user.userId,
      }),
    );
    expect(fromParent.total).toBe(2);
    expect(fromParent.balanceAfter).toBe(afterChild.body.pointsBalance - 2);

    const detail = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${first.body.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(detail.body.companies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.body.id }),
        expect.objectContaining({ id: second.body.id }),
      ]),
    );
    expect(detail.body.limits.companies.used).toBe(2);

    const usage = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${first.body.id}/usage`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(usage.body.accountUsage.companies.length).toBe(2);
    expect(usage.body.pointsBalance).toBe(fromParent.balanceAfter);
  });

  it('blocks send against the shared account balance with the existing 402', async () => {
    if (!dbAvailable) return;
    const t = `low${Date.now()}`;
    const user = await registerUser(app, t);
    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Low ${t}` })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/platform-admin/tenants/${created.body.id}/document-costs`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ items: [{ documentKind: 'INVOICE', points: 9999 }] })
      .expect(200);

    const points = app.get(PointsService);
    const tenantPrisma = app.get(TenantPrismaService);
    await expect(
      tenantPrisma.withTenant(created.body.id, (tx) =>
        points.consumeForSendInTx(tx, {
          tenantId: created.body.id,
          kinds: ['INVOICE'],
          documentIds: ['00000000-0000-4000-8000-000000000012'],
          actorUserId: user.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientPointsHttpException);
  });
});
