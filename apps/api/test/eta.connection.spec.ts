import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ETA_SETTINGS_PATH } from '../src/eta/eta-service.types';

async function registerTenant(app: INestApplication, suffix: string) {
  const email = `eta_conn_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'Conn User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Conn Tenant ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('ETA connection API (mocked)', () => {
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

  it('GET connection shows setupRequired; POST test returns accessToken; GET strips token', async () => {
    const mockToken = `conn-tok-${Date.now()}`;
    global.fetch = (async (url) => {
      if (String(url).includes('/connect/token')) {
        return new Response(
          JSON.stringify({
            access_token: mockToken,
            expires_in: 3600,
            scope: 'InvoicingAPI',
          }),
          { status: 200 },
        );
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const ctx = await registerTenant(app, String(Date.now()));
    const secret = `s-${Date.now()}`;

    const before = await request(app.getHttpServer())
      .get('/settings/eta/connection')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(before.body.setupRequired).toBe(true);
    expect(before.body.settingsPath).toBe(ETA_SETTINGS_PATH);
    expect(before.body.accessToken).toBeUndefined();
    expect(JSON.stringify(before.body)).not.toMatch(/access_token/i);

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ clientId: 'c1', clientSecret: secret })
      .expect(200);

    const tested = await request(app.getHttpServer())
      .post('/settings/eta-credentials/test-connection')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(200);

    expect(tested.body.connected).toBe(true);
    expect(tested.body.accessToken).toBe(mockToken);
    expect(JSON.stringify(tested.body)).not.toContain(secret);
    expect(tested.body.clientSecret).toBeUndefined();

    const after = await request(app.getHttpServer())
      .get('/settings/eta/connection')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(after.body.connected).toBe(true);
    expect(after.body.accessToken).toBeUndefined();
    expect(JSON.stringify(after.body)).not.toMatch(/access_token|"accessToken"/);
  });
});
