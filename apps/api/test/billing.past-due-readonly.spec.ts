import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { SubscriptionService } from '../src/billing/subscription.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `pd_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `PastDue ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

/**
 * READ_ONLY (past-due, grace expired) blocks tenant writes everywhere except
 * the billing "self-heal" routes (checkout / change-plan / enterprise-request
 * / webhooks) and all GET/HEAD reads (tenant-access.guard.ts).
 */
describe('READ_ONLY subscription status blocks tenant writes (US5)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Billing past-due read-only');
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

  it('blocks POST /branches with 403 once the subscription is READ_ONLY', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const subscriptions = app.get(SubscriptionService);
    await subscriptions.setStatus(ctx.tenantId, 'READ_ONLY', { graceEndsAt: new Date(Date.now() - 1000) });

    const res = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ name: 'Should be blocked' })
      .expect(403);
    expect(res.body.message).toBe('tenant_read_only');

    // Reads stay open under READ_ONLY.
    await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const view = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(view.body.status).toBe('READ_ONLY');
    expect(view.body.accessMode).toBe('READ_ONLY');
  });

  it('billing recovery routes stay open under READ_ONLY (self-heal)', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `heal${Date.now()}`);
    const subscriptions = app.get(SubscriptionService);
    await subscriptions.setStatus(ctx.tenantId, 'READ_ONLY', { graceEndsAt: new Date(Date.now() - 1000) });

    // change-plan is a billing-recovery path: allowed even while READ_ONLY.
    const res = await request(app.getHttpServer())
      .post('/billing/change-plan')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ planCode: 'FREE' })
      .expect(201);
    expect(res.body.plan.code).toBe('FREE');
    // Recovering to an ACTIVE Free plan clears the READ_ONLY state.
    expect(res.body.status).toBe('ACTIVE');
  });

  it('a SUSPENDED subscription also blocks writes with 403', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `susp${Date.now()}`);
    const subscriptions = app.get(SubscriptionService);
    await subscriptions.setStatus(ctx.tenantId, 'SUSPENDED');

    const res = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ name: 'Should be blocked' })
      .expect(403);
    expect(res.body.message).toBe('tenant_suspended');
  });
});
