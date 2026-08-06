import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { UsageEventService } from '../src/analytics/usage-event.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { bucketDateInTz } from '../src/analytics/usage-aggregate';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `analytics_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Analytics ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('Analytics accuracy vs events (T018)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Analytics accuracy vs events');
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

  it('summary totals exactly equal aggregates from UsageEvent', async () => {
    if (!dbAvailable) return;

    const ctx = await ownerCtx(app, `${Date.now()}`);
    const events = app.get(UsageEventService);
    const analytics = app.get(AnalyticsService);

    const day = bucketDateInTz(new Date(), 'Africa/Cairo');
    const occurredAt = new Date();

    const fixture = {
      issued: 3,
      received: 2,
      valid: 2,
      invalid: 1,
      api_calls: 7,
      storage_bytes: 4096,
    };

    for (let i = 0; i < fixture.issued; i++) {
      await events.append({
        tenantId: ctx.tenantId,
        meter: 'issued',
        quantity: 1,
        occurredAt,
        idempotencyKey: `issued:fix-${i}`,
        branchId: null,
        currencyCode: 'EGP',
      });
    }
    for (let i = 0; i < fixture.received; i++) {
      await events.append({
        tenantId: ctx.tenantId,
        meter: 'received',
        quantity: 1,
        occurredAt,
        idempotencyKey: `received:fix-${i}`,
        currencyCode: 'EGP',
      });
    }
    for (let i = 0; i < fixture.valid; i++) {
      await events.append({
        tenantId: ctx.tenantId,
        meter: 'valid',
        quantity: 1,
        occurredAt,
        idempotencyKey: `valid:fix-${i}`,
        currencyCode: 'EGP',
      });
    }
    for (let i = 0; i < fixture.invalid; i++) {
      await events.append({
        tenantId: ctx.tenantId,
        meter: 'invalid',
        quantity: 1,
        occurredAt,
        idempotencyKey: `invalid:fix-${i}`,
        currencyCode: 'EGP',
      });
    }
    await events.append({
      tenantId: ctx.tenantId,
      meter: 'api_calls',
      quantity: fixture.api_calls,
      occurredAt,
      idempotencyKey: `api:fix`,
    });
    await events.append({
      tenantId: ctx.tenantId,
      meter: 'storage_bytes',
      quantity: fixture.storage_bytes,
      occurredAt,
      idempotencyKey: `storage:fix`,
    });

    const cmp = await analytics.accuracyCompare({
      tenantId: ctx.tenantId,
      from: day,
      to: day,
    });

    expect(cmp.match).toBe(true);
    expect(cmp.fromEvents).toEqual(fixture);
    expect(cmp.fromRollups).toEqual(fixture);

    const res = await request(app.getHttpServer())
      .get(`/analytics/summary?from=${day}&to=${day}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(res.body.totals).toEqual(fixture);
  });

  it('does not leak tenant B events into tenant A summary', async () => {
    if (!dbAvailable) return;

    const a = await ownerCtx(app, `a-${Date.now()}`);
    const b = await ownerCtx(app, `b-${Date.now()}`);
    const events = app.get(UsageEventService);
    const day = bucketDateInTz(new Date(), 'Africa/Cairo');
    const occurredAt = new Date();

    await events.append({
      tenantId: a.tenantId,
      meter: 'issued',
      quantity: 1,
      occurredAt,
      idempotencyKey: 'issued:a-only',
    });
    await events.append({
      tenantId: b.tenantId,
      meter: 'issued',
      quantity: 99,
      occurredAt,
      idempotencyKey: 'issued:b-only',
    });

    const res = await request(app.getHttpServer())
      .get(`/analytics/summary?from=${day}&to=${day}`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(200);

    expect(res.body.totals.issued).toBe(1);
  });
});
