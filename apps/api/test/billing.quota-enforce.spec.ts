import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { QuotaService } from '../src/billing/quota.service';
import { QuotaExceededHttpException } from '../src/billing/quota-errors';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `qe_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Quota ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
    userId: reg.body.user.id as string,
  };
}

/**
 * BLOCKING GATE (013-saas-layer): every quota-enforced mutate path must refuse
 * with the stable `QUOTA_EXCEEDED` body (409) once `used >= limit`, for all
 * three resources — branches, devices, documents.
 */
describe('Billing quota enforcement GATE', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Billing quota-enforce');
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

  it('branches: Free plan already has the Main branch (limit 1) — a second branch is refused', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));

    const res = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ name: 'Second Branch', etaBranchCode: '1', activityCode: '6201' })
      .expect(409);

    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      resource: 'branches',
      used: 1,
      limit: 1,
    });
  });

  it('devices: a QuotaOverride of deviceQuota=0 refuses /agent/pair before the pairing code is even looked up', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `dev${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.quotaOverride.create({
        data: {
          tenantId: ctx.tenantId,
          deviceQuota: 0,
          reason: 'test: zero out device quota',
          createdByUserId: ctx.userId,
        },
      }),
    );

    // Syntactically valid (tenant-prefixed) but otherwise fake pairing code —
    // the quota gate must run before any pairing-code lookup.
    const fakeCode = `${ctx.tenantId}.${'deadbeef'.repeat(3)}`;
    const res = await request(app.getHttpServer())
      .post('/agent/pair')
      .send({ pairingCode: fakeCode, label: 'Test Device' })
      .expect(409);

    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      resource: 'devices',
      used: 0,
      limit: 0,
    });
  });

  it('documents: a QuotaOverride of documentQuota=0 refuses submit before any ETA call', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `doc${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.quotaOverride.create({
        data: {
          tenantId: ctx.tenantId,
          documentQuota: 0,
          reason: 'test: zero out document quota',
          createdByUserId: ctx.userId,
        },
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/documents/${randomUUID()}/submit`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .set('Idempotency-Key', `test-idem-${Date.now()}`)
      .expect(409);

    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      resource: 'documents',
      used: 0,
      limit: 0,
    });

    // Direct QuotaService assertion — same override, exercised without HTTP.
    const quota = app.get(QuotaService);
    await expect(quota.assertWithinLimits(ctx.tenantId, 'documents')).rejects.toBeInstanceOf(
      QuotaExceededHttpException,
    );
  });
});
