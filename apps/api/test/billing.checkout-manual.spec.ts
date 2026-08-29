import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `chk_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Checkout ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Manual WhatsApp checkout (Stripe disabled)', () => {
  let app: INestApplication;
  let dbAvailable = true;
  const prevKey = process.env.STRIPE_SECRET_KEY;
  const prevProvider = process.env.BILLING_PROVIDER;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Manual WhatsApp checkout');
      return;
    }
    process.env.STRIPE_SECRET_KEY = 'sk_test_CHANGE_ME';
    process.env.BILLING_PROVIDER = 'stripe';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevKey;
    if (prevProvider === undefined) delete process.env.BILLING_PROVIDER;
    else process.env.BILLING_PROVIDER = prevProvider;
    if (app) await app.close();
  });

  it('POST /billing/checkout returns WhatsApp contact and never a Stripe URL or API-key error', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const res = await request(app.getHttpServer())
      .post('/billing/checkout')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ planCode: 'STARTER' });

    expect(res.status).toBeLessThan(400);
    expect(JSON.stringify(res.body)).not.toMatch(/Invalid API Key/i);
    expect(res.body.checkoutUrl).toBeUndefined();
    expect(res.body.mode).toBe('manual');
    expect(res.body.planCode).toBe('STARTER');
    expect(res.body.whatsappUrl).toMatch(/wa\.me\/201000864620/);
    expect(res.body.whatsappDisplay).toBe('00201000864620');
  });
});
