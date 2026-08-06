import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { SubscriptionService } from '../src/billing/subscription.service';
import { BillingPastDueProcessor } from '../src/billing/billing-past-due.processor';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `pds_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `PastDueSweep ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

/**
 * Unit-level coverage for the T057 grace sweep (`billing-past-due.processor.ts`):
 * a PAST_DUE subscription with an expired `graceEndsAt` flips to READ_ONLY,
 * while one still inside its grace window is left untouched.
 */
describe('Billing past-due grace sweep (T057)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Billing past-due sweep');
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

  it('moves an expired-grace PAST_DUE subscription to READ_ONLY and audits it', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const subscriptions = app.get(SubscriptionService);
    await subscriptions.setStatus(ctx.tenantId, 'PAST_DUE', {
      graceEndsAt: new Date(Date.now() - 1000),
    });

    const processor = app.get(BillingPastDueProcessor);
    const { movedTenantIds } = await processor.sweep();
    expect(movedTenantIds).toContain(ctx.tenantId);

    const view = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(view.body.status).toBe('READ_ONLY');
  });

  it('leaves a PAST_DUE subscription still inside its grace window alone', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `grace${Date.now()}`);
    const subscriptions = app.get(SubscriptionService);
    await subscriptions.setStatus(ctx.tenantId, 'PAST_DUE', {
      graceEndsAt: new Date(Date.now() + 60_000),
    });

    const processor = app.get(BillingPastDueProcessor);
    const { movedTenantIds } = await processor.sweep();
    expect(movedTenantIds).not.toContain(ctx.tenantId);

    const view = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(view.body.status).toBe('PAST_DUE');
  });
});
