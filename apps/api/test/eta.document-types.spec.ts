import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/** Hardcoded fixture that must NOT be the live catalog source of truth. */
const HARDCODED_PRODUCT_FIXTURE = [
  { documentTypeId: 'I', description: 'Invoice (hardcoded fixture)' },
];

async function registerTenant(app: INestApplication, suffix: string) {
  const email = `eta_dt_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'DT User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `DT Tenant ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('ETA document types API (mocked)', () => {
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

  it('lists types/versions from mocked ETA JSON; refresh bypasses cache', async () => {
    const liveCatalog = [
      { documentTypeId: 'I', descriptionPrimaryLang: 'Invoice' },
      { documentTypeId: 'C', descriptionPrimaryLang: 'Credit' },
    ];
    let typesHits = 0;
    global.fetch = (async (url) => {
      const u = String(url);
      if (u.includes('/connect/token')) {
        return new Response(
          JSON.stringify({ access_token: 'dt-tok', expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (u.includes('/documenttypes/') && u.includes('/versions')) {
        return new Response(
          JSON.stringify([{ versionNumber: 1.0, status: 'Published' }]),
          { status: 200 },
        );
      }
      if (u.includes('/documenttypes')) {
        typesHits += 1;
        return new Response(JSON.stringify(liveCatalog), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const ctx = await registerTenant(app, String(Date.now()));
    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ clientId: 'c', clientSecret: 'secret-dt' })
      .expect(200);

    const list1 = await request(app.getHttpServer())
      .get('/settings/eta/document-types')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(list1.body.items).toEqual(liveCatalog);
    expect(list1.body.items).not.toEqual(HARDCODED_PRODUCT_FIXTURE);
    expect(typesHits).toBe(1);

    const list2 = await request(app.getHttpServer())
      .get('/settings/eta/document-types')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(list2.body.fromCache).toBe(true);
    expect(typesHits).toBe(1);

    const refreshed = await request(app.getHttpServer())
      .get('/settings/eta/document-types?refresh=true')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(refreshed.body.fromCache).toBe(false);
    expect(typesHits).toBe(2);

    const versions = await request(app.getHttpServer())
      .get('/settings/eta/document-types/I/versions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(versions.body.documentTypeId).toBe('I');
    expect(versions.body.items.length).toBeGreaterThan(0);
  });
});
