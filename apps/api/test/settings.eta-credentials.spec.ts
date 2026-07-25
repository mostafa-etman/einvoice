import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';


async function registerTenant(app: INestApplication, suffix: string) {
  const email = `eta_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'ETA User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `ETA Tenant ${suffix}` })
    .expect(201);
  return {
    email,
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('ETA credentials API', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    tenantPrisma = app.get(TenantPrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('upserts, returns masked secret, rotates; audit omits secret', async () => {
    const ctx = await registerTenant(app, String(Date.now()));
    const plaintext = `plain-secret-${Date.now()}`;

    const put = await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        clientId: 'client-1',
        clientSecret: plaintext,
        registrationNumber: '123456789',
        activityCode: '1000',
        isIntermediary: false,
      })
      .expect(200);

    expect(put.body.clientId).toBe('client-1');
    expect(put.body.hasClientSecret).toBe(true);
    expect(put.body.clientSecretMasked).toBe('••••••••');
    expect(JSON.stringify(put.body)).not.toContain(plaintext);
    expect(put.body.clientSecret).toBeUndefined();

    const get = await request(app.getHttpServer())
      .get('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(get.body.clientSecretMasked).toBe('••••••••');
    expect(JSON.stringify(get.body)).not.toContain(plaintext);

    const rotated = `rotated-${Date.now()}`;
    const rot = await request(app.getHttpServer())
      .post('/settings/eta-credentials/rotate-secret')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ clientSecret: rotated })
      .expect(200);
    expect(JSON.stringify(rot.body)).not.toContain(rotated);
    expect(JSON.stringify(rot.body)).not.toContain(plaintext);

    const audits = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: ctx.tenantId,
          action: {
            in: [
              'settings.eta_credentials.upsert',
              'settings.eta_credentials.rotate',
            ],
          },
        },
      }),
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const a of audits) {
      const blob = JSON.stringify(a.metadata ?? {});
      expect(blob).not.toContain(plaintext);
      expect(blob).not.toContain(rotated);
      expect(blob).not.toMatch(/client_secret|clientSecretCiphertext/i);
    }
  });
});
