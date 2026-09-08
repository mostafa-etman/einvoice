import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TRIAL_ALREADY_USED_CODE } from '../src/billing/tax-registration';

async function registerUser(app: INestApplication, suffix: string) {
  const email = `ttr_${suffix}@example.com`;
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

function nineDigitTin(seed: string): string {
  const digits = seed.replace(/\D/g, '').padStart(8, '0').slice(-8);
  return `9${digits}`;
}

describe('Trial per tax registration + plan visibility', () => {
  let app: INestApplication;
  let dbAvailable = true;
  const prev = process.env.SIGNUP_AUTO_APPROVE;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Trial per tax registration + plan visibility');
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

  it('grants a trial once per tax registration number and returns AR/EN copy on reuse', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const tin = nineDigitTin(String(t));
    const first = await registerUser(app, `a${t}`);
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ name: `Trial TIN Co ${t}`, taxRegistrationNumber: tin })
      .expect(201);
    expect(created.body.activationStatus).toBe('ACTIVE');
    expect(created.body.trialEndsAt).toBeTruthy();

    const prisma = app.get(PrismaService);
    const row = await prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: tin },
    });
    expect(row?.firstTenantId).toBe(created.body.id);

    const second = await registerUser(app, `b${t}`);
    const blocked = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ name: `Reuse TIN Co ${t}`, taxRegistrationNumber: ` ${tin} ` });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(TRIAL_ALREADY_USED_CODE);
    expect(blocked.body.messageAr).toContain('رقم التسجيل الضريبي ده استخدم الخطة المجانية قبل كده');
    expect(blocked.body.messageEn).toContain('already used a free trial');
    expect(blocked.body.whatsappDisplay).toBeTruthy();

    const firstAfter = await prisma.tenant.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(firstAfter.trialEndsAt).toBeTruthy();

    const paid = await registerUser(app, `paid${t}`);
    const paidSignup = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${paid.token}`)
      .send({
        name: `Paid after TIN ${t}`,
        planCode: 'BASIC',
        taxRegistrationNumber: tin,
      })
      .expect(201);
    expect(paidSignup.body.activationStatus).toBe('PENDING');
    expect(paidSignup.body.trialEndsAt).toBeFalsy();

    const retryUser = await registerUser(app, `retry${t}`);
    const retryTrial = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${retryUser.token}`)
      .send({
        name: `Retry trial ${t}`,
        planCode: 'TRIAL',
        taxRegistrationNumber: tin,
      });
    expect(retryTrial.status).toBe(409);
    expect(retryTrial.body.code).toBe(TRIAL_ALREADY_USED_CODE);
  });

  it('binds the tax number when a trial tenant registers it later, then blocks a second trial', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const tin = nineDigitTin(`2${t}`);
    const first = await registerUser(app, `c${t}`);
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ name: `Deferred TIN ${t}` })
      .expect(201);
    expect(created.body.trialEndsAt).toBeTruthy();

    const put = await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${first.token}`)
      .set('X-Tenant-Id', created.body.id)
      .send({
        clientId: 'client-trial',
        clientSecret: `secret-${t}`,
        registrationNumber: tin,
        taxpayerLegalName: `Legal ${t}`,
        issuerType: 'B',
        activityCode: '1000',
        isIntermediary: false,
      });
    expect(put.status).toBe(200);

    const prisma = app.get(PrismaService);
    const row = await prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: tin },
    });
    expect(row?.firstTenantId).toBe(created.body.id);

    const second = await registerUser(app, `d${t}`);
    const blocked = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ name: `Second deferred ${t}`, taxRegistrationNumber: tin });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(TRIAL_ALREADY_USED_CODE);
  });

  it('lets the platform owner reset a tax registration so a new trial can be granted', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const tin = nineDigitTin(`3${t}`);
    const first = await registerUser(app, `e${t}`);
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ name: `Reset TIN ${t}`, taxRegistrationNumber: tin })
      .expect(201);

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: first.userId },
      data: { isPlatformOperator: true },
    });

    const listed = await request(app.getHttpServer())
      .get('/platform-admin/trial-tax-registrations')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    expect(
      (listed.body.items as Array<{ taxRegistrationNormalized: string }>).some(
        (i) => i.taxRegistrationNormalized === tin,
      ),
    ).toBe(true);

    const reset = await request(app.getHttpServer())
      .post('/platform-admin/trial-tax-registrations/reset')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ taxRegistrationNumber: tin, reason: 'test reset' });
    expect([200, 201]).toContain(reset.status);

    const afterReset = await prisma.trialUsedTaxRegistration.findUnique({
      where: { taxRegistrationNormalized: tin },
    });
    expect(afterReset).toBeNull();

    const second = await registerUser(app, `f${t}`);
    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ name: `After reset ${t}`, taxRegistrationNumber: tin })
      .expect(201);
    expect(created.body.trialEndsAt).toBeTruthy();
  });

  it('hides inactive plans from the customer catalog while admin still sees them', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const code = `HID${String(t).slice(-8)}`;
    const user = await registerUser(app, `g${t}`);
    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });

    const createdPlan = await request(app.getHttpServer())
      .post('/platform-admin/plans')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        code,
        nameEn: 'Hidden Test',
        nameAr: 'مخفية',
        documentQuota: 10,
        branchQuota: 1,
        deviceQuota: 1,
        includedPoints: 0,
        officialPriceEgp: 100,
        discountedPriceEgp: 80,
        maxUsers: 1,
        maxCompanies: 1,
        isPublic: true,
        isActive: true,
        sortOrder: 99,
      });
    expect([200, 201]).toContain(createdPlan.status);

    const before = await request(app.getHttpServer())
      .get('/billing/catalog')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((before.body.plans as Array<{ code: string }>).map((p) => p.code)).toContain(code);

    const toggled = await request(app.getHttpServer())
      .patch(`/platform-admin/plans/${code}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ isActive: false });
    expect([200, 201]).toContain(toggled.status);
    expect(toggled.body.isActive).toBe(false);

    const after = await request(app.getHttpServer())
      .get('/billing/catalog')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((after.body.plans as Array<{ code: string }>).map((p) => p.code)).not.toContain(code);

    const admin = await request(app.getHttpServer())
      .get('/platform-admin/plans')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const adminPlan = (admin.body.plans as Array<{ code: string; isActive: boolean }>).find(
      (p) => p.code === code,
    );
    expect(adminPlan?.isActive).toBe(false);
  });
});
