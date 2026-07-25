import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ETA_SETUP_CODE, ETA_SETTINGS_PATH } from '../src/eta/eta-service.types';
import { tokenCacheKey } from '../src/eta/eta-token.cache';

async function registerTenant(app: INestApplication, suffix: string) {
  const email = `eta_tok_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'Tok User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Tok Tenant ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('ETA token orchestration (mocked)', () => {
  let app: INestApplication;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    originalFetch = global.fetch;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns setup-required without calling ETA when credentials missing', async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 500 });
    }) as typeof fetch;

    const ctx = await registerTenant(app, `miss_${Date.now()}`);
    const res = await request(app.getHttpServer())
      .post('/settings/eta-credentials/test-connection')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(400);

    expect(res.body.code || res.body.message).toBeTruthy();
    const blob = JSON.stringify(res.body);
    expect(blob).toMatch(new RegExp(ETA_SETUP_CODE));
    expect(blob).toContain(ETA_SETTINGS_PATH);
    expect(fetchCalls).toBe(0);
  });

  it('acquires token via mocked ETA and keys Redis by tenantId', async () => {
    const mockToken = `mock-access-${Date.now()}`;
    global.fetch = (async (url) => {
      const u = String(url);
      if (u.includes('/connect/token')) {
        return new Response(
          JSON.stringify({
            access_token: mockToken,
            expires_in: 3600,
            scope: 'InvoicingAPI',
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const ctx = await registerTenant(app, `ok_${Date.now()}`);
    const secret = `secret-${Date.now()}`;
    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        clientId: 'cid-mock',
        clientSecret: secret,
        registrationNumber: '111',
      })
      .expect(200);

    const test = await request(app.getHttpServer())
      .post('/settings/eta-credentials/test-connection')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(200);

    expect(test.body.connected).toBe(true);
    expect(test.body.accessToken).toBe(mockToken);
    expect(JSON.stringify(test.body)).not.toContain(secret);
    expect(tokenCacheKey(ctx.tenantId)).toContain(ctx.tenantId);
  });
});
