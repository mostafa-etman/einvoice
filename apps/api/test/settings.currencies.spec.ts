import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `cur_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Cur ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Settings currencies & rates API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('enables currencies, sets default, CRUD rates and rejects overlap', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));

    const catalog = await request(app.getHttpServer())
      .get('/currencies/catalog')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(catalog.body.some((c: { code: string }) => c.code === 'EGP')).toBe(
      true,
    );

    await request(app.getHttpServer())
      .post('/currencies')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ currencyCode: 'EGP', isDefault: true })
      .expect(201);

    await request(app.getHttpServer())
      .post('/currencies')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ currencyCode: 'USD' })
      .expect(201);

    await request(app.getHttpServer())
      .put('/currencies/default')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ currencyCode: 'USD' })
      .expect(200);

    const from = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const rate = await request(app.getHttpServer())
      .post('/exchange-rates')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        baseCurrencyCode: 'USD',
        quoteCurrencyCode: 'EGP',
        rate: '50.5',
        effectiveFrom: from,
      })
      .expect(201);
    expect(rate.body.rate).toBe('50.5');
    expect(rate.body.source).toBe('MANUAL');

    await request(app.getHttpServer())
      .post('/exchange-rates')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        baseCurrencyCode: 'USD',
        quoteCurrencyCode: 'EGP',
        rate: '51',
        effectiveFrom: from,
      })
      .expect(400);
  });
});
