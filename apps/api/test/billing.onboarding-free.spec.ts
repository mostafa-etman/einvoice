import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `onb_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Onboarding ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Billing onboarding — every new tenant gets an ACTIVE Free subscription (US1)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Billing onboarding-free');
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

  it('a freshly provisioned tenant is on Free with 100/1/1 quotas', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));

    const res = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(res.body.plan.code).toBe('FREE');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.accessMode).toBe('FULL');
    expect(res.body.entitlements).toMatchObject({
      documentQuota: 100,
      branchQuota: 1,
      deviceQuota: 1,
      overrideActive: false,
    });

    const quotas = await request(app.getHttpServer())
      .get('/billing/quotas')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(quotas.body.documents.limit).toBe(100);
    expect(quotas.body.branches.limit).toBe(1);
    expect(quotas.body.devices.limit).toBe(1);
    // Only the auto-created "Main" branch exists so far.
    expect(quotas.body.branches.used).toBe(1);
    expect(quotas.body.devices.used).toBe(0);
  });

  it('a second, independent registration + tenant is isolated from the first', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const first = await ownerCtx(app, `a${t}`);
    const second = await ownerCtx(app, `b${t}`);

    expect(first.tenantId).not.toBe(second.tenantId);

    const firstSub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${first.token}`)
      .set('X-Tenant-Id', first.tenantId)
      .expect(200);
    const secondSub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${second.token}`)
      .set('X-Tenant-Id', second.tenantId)
      .expect(200);

    expect(firstSub.body.plan.code).toBe('FREE');
    expect(secondSub.body.plan.code).toBe('FREE');

    // Cross-tenant header mismatch must never leak the other tenant's data.
    await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${first.token}`)
      .set('X-Tenant-Id', second.tenantId)
      .expect((res) => {
        expect([403, 404]).toContain(res.status);
      });
  });
});
