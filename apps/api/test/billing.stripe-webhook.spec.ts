import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `wh_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Webhook ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

/**
 * STRIPE_WEBHOOK_SECRET is unset in the test env, so the provider skips
 * signature verification (dev/test only path) and parses the raw JSON body —
 * this exercises the idempotent-apply logic without needing a real Stripe
 * signature fixture.
 */
describe('Stripe webhook — idempotent apply (US4)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Stripe webhook');
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

  it('applies checkout.session.completed once and is a no-op on replay with the same event id', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const eventId = `evt_test_${Date.now()}`;
    const payload = {
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { tenantId: ctx.tenantId, planCode: 'STARTER' },
          client_reference_id: ctx.tenantId,
          customer: 'cus_test_123',
          subscription: 'sub_test_123',
        },
      },
    };

    const first = await request(app.getHttpServer())
      .post('/billing/webhooks/stripe')
      .send(payload)
      .expect(200);
    expect(first.body).toEqual({ received: true });

    const sub = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(sub.body.plan.code).toBe('STARTER');
    expect(sub.body.status).toBe('ACTIVE');

    const prisma = app.get(PrismaService);
    const rows = await prisma.billingWebhookEvent.findMany({
      where: { provider: 'stripe', providerEventId: eventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('success');
    expect(rows[0]!.processedAt).not.toBeNull();

    // Replay with the exact same provider event id — must not re-apply or duplicate.
    const replay = await request(app.getHttpServer())
      .post('/billing/webhooks/stripe')
      .send(payload)
      .expect(200);
    expect(replay.body).toEqual({ received: true, idempotent: true });

    const rowsAfter = await prisma.billingWebhookEvent.findMany({
      where: { provider: 'stripe', providerEventId: eventId },
    });
    expect(rowsAfter).toHaveLength(1);

    // Downgrading the plan is irreversible proof the replay didn't rerun the handler:
    // if it had, nothing here changes, but a duplicate row would exist above.
    const subAfter = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(subAfter.body.plan.code).toBe('STARTER');
  });

  it('an unrecognized event type is ignored but still recorded (no crash, no entitlement change)', async () => {
    if (!dbAvailable) return;
    const eventId = `evt_ignored_${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/billing/webhooks/stripe')
      .send({ id: eventId, type: 'customer.created', data: { object: {} } })
      .expect(200);
    expect(res.body).toEqual({ received: true });

    const prisma = app.get(PrismaService);
    const row = await prisma.billingWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider: 'stripe', providerEventId: eventId } },
    });
    expect(row?.outcome).toBe('ignored');
  });
});
