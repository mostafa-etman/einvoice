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
  const email = `offer_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  return {
    email,
    password,
    token: reg.body.accessToken as string,
    userId: reg.body.user.id as string,
  };
}

describe('Official offer pricing', () => {
  let app: INestApplication;
  let dbAvailable = true;
  const prev = process.env.SIGNUP_AUTO_APPROVE;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Official offer pricing');
      return;
    }
    process.env.SIGNUP_AUTO_APPROVE = 'false';
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

  it('exposes the 5 public plans with before/after EGP prices and add-ons', async () => {
    if (!dbAvailable) return;
    const user = await registerUser(app, `cat${Date.now()}`);
    const res = await request(app.getHttpServer())
      .get('/billing/catalog')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    const codes = (res.body.plans as Array<{ code: string }>).map((p) => p.code);
    expect(codes).toEqual(['BASIC', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);
    const basic = res.body.plans.find((p: { code: string }) => p.code === 'BASIC');
    expect(basic.officialPriceEgp).toBe(400);
    expect(basic.discountedPriceEgp).toBe(250);
    expect(basic.includedPoints).toBe(500);
    expect(basic.maxUsers).toBe(1);
    expect(basic.maxCompanies).toBe(1);
    expect(basic.savingsPercent).toBeGreaterThan(0);
    expect(res.body.addons.map((a: { code: string }) => a.code)).toEqual(
      expect.arrayContaining(['POINTS_4500', 'EXTRA_USER', 'EXTRA_COMPANY']),
    );
    expect(res.body.trialDays).toBeGreaterThanOrEqual(1);
  });

  it('starts a new signup on an ACTIVE trial, not pending', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const user = await registerUser(app, String(t));
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Trial Co ${t}` })
      .expect(201);

    expect(created.body.activationStatus).toBe('ACTIVE');
    expect(created.body.trialEndsAt).toBeTruthy();
    const prisma = app.get(PrismaService);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(tenant.pointsBalance).toBeGreaterThan(0);
    const sub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', created.body.id)
      .expect(200);
    expect(sub.body.plan.code).toBe('TRIAL');
    expect(sub.body.plan.isTrial).toBe(true);
  });

  it('blocks send after trial ends and blocks extra users/companies', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const user = await registerUser(app, `lim${t}`);
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Limit Co ${t}` })
      .expect(201);
    const tenantId = created.body.id as string;
    const prisma = app.get(PrismaService);
    const tenantPrisma = app.get(TenantPrismaService);
    const points = app.get(PointsService);

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { trialEndsAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      tenantPrisma.withTenant(tenantId, (tx) =>
        points.consumeForSendInTx(tx, {
          tenantId,
          kinds: ['INVOICE'],
          documentIds: ['00000000-0000-4000-8000-000000000002'],
          actorUserId: user.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientPointsHttpException);

    const second = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Second ${t}` });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('COMPANY_LIMIT_EXCEEDED');

    await prisma.user.update({ where: { id: user.userId }, data: { isPlatformOperator: true } });
    const assigned = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantId}/plan`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ planCode: 'BASIC', reason: 'paid' });
    expect([200, 201]).toContain(assigned.status);

    const after = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(after.body.planCode).toBe('BASIC');
    expect(after.body.trialEndsAt).toBeNull();
  });
});
