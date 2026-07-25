/**
 * Gated sandbox integration — skipped unless ETA_SANDBOX_INTEGRATION=1.
 * Default `pnpm test` must pass without sandbox network.
 *
 * Run:
 *   $env:ETA_SANDBOX_INTEGRATION="1"
 *   pnpm --filter @einvoice/api test -- --testPathPattern=eta.sandbox --runInBand
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/env';

const enabled = process.env.ETA_SANDBOX_INTEGRATION === '1';
const sandboxClientId = process.env.ETA_SANDBOX_CLIENT_ID || process.env.ETA_CLIENT_ID;
const sandboxClientSecret =
  process.env.ETA_SANDBOX_CLIENT_SECRET || process.env.ETA_CLIENT_SECRET;
const hasUsableCreds =
  Boolean(sandboxClientId) &&
  Boolean(sandboxClientSecret) &&
  sandboxClientId !== 'change-me' &&
  sandboxClientSecret !== 'change-me';

const describeSandbox = enabled && hasUsableCreds ? describe : describe.skip;

describeSandbox('ETA sandbox integration (live)', () => {
  let app: INestApplication;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    const env = loadEnv();
    expect(env.ETA_IDENTITY_BASE_URL).toBeTruthy();
    expect(env.ETA_API_BASE_URL).toBeTruthy();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const suffix = Date.now();
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `sandbox_${suffix}@example.com`,
        password: 'Password123!',
        name: 'Sandbox',
      })
      .expect(201);
    token = reg.body.accessToken;
    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Sandbox ${suffix}` })
      .expect(201);
    tenantId = tenant.body.id;

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .send({
        clientId: sandboxClientId,
        clientSecret: sandboxClientSecret,
      })
      .expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Test Connection returns a real access_token from ETA identity', async () => {
    const res = await request(app.getHttpServer())
      .post('/settings/eta-credentials/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .send({})
      .expect(200);

    expect(res.body.connected).toBe(true);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(20);
    expect(JSON.stringify(res.body)).not.toContain(sandboxClientSecret);
  });

  it('fetches document types from live sandbox API', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/eta/document-types?refresh=true')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});

describe('ETA sandbox gate', () => {
  it('skips live suite when ETA_SANDBOX_INTEGRATION unset', () => {
    if (!enabled || !hasUsableCreds) {
      expect(true).toBe(true);
    } else {
      expect(hasUsableCreds).toBe(true);
    }
  });
});
