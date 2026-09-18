import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

const COMPLETE_ADDRESS = {
  country: 'EG',
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Main',
  buildingNumber: '1',
};

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `br_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Branches ${suffix}` })
    .expect(201);
  const tenantId = tenant.body.id as string;
  const userId = reg.body.user.id as string;

  const tenantPrisma = app.get(TenantPrismaService);
  await tenantPrisma.withTenant(tenantId, (tx) =>
    tx.quotaOverride.create({
      data: {
        tenantId,
        branchQuota: 10,
        deviceQuota: 10,
        reason: 'test: allow multiple branches/POS in the branches settings suite',
        createdByUserId: userId,
      },
    }),
  );

  return { token: reg.body.accessToken as string, tenantId };
}

describe('Settings branches API', () => {
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

  it('creates and updates branches with single default', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));

    const created = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        name: 'Secondary',
        isDefault: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: COMPLETE_ADDRESS,
      })
      .expect(201);

    expect(created.body.isDefault).toBe(true);
    expect(created.body.isActive).toBe(true);
    expect(created.body.receiptsEnabled).toBe(false);
    expect(created.body.receiptsReady).toBe(false);

    const list = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const defaults = list.body.filter((b: { isDefault: boolean }) => b.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(created.body.id);

    await request(app.getHttpServer())
      .patch(`/branches/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ activityCode: '6202' })
      .expect(200);
  });

  it('keeps invoice-only branches working without ETA branch/activity codes', async () => {
    const ctx = await ownerCtx(app, `inv${Date.now()}`);
    const list = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const main = list.body[0] as { id: string; receiptsEnabled: boolean };
    expect(main.receiptsEnabled).toBe(false);

    await request(app.getHttpServer())
      .patch(`/branches/${main.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ name: 'Main HQ' })
      .expect(200);
  });

  it('refuses receiptsEnabled until portal branch code, activity, and address are set', async () => {
    const ctx = await ownerCtx(app, `rcpt${Date.now()}`);
    const list = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const main = list.body[0] as { id: string };

    const res = await request(app.getHttpServer())
      .patch(`/branches/${main.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ receiptsEnabled: true })
      .expect(400);
    expect(res.body.code).toBe('RECEIPT_BRANCH_INCOMPLETE');
    expect(res.body.gaps).toEqual(
      expect.arrayContaining(['MISSING_ETA_BRANCH_CODE', 'MISSING_ACTIVITY_CODE']),
    );

    const ok = await request(app.getHttpServer())
      .patch(`/branches/${main.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: COMPLETE_ADDRESS,
      })
      .expect(200);
    expect(ok.body.receiptsEnabled).toBe(true);
    expect(ok.body.receiptsReady).toBe(true);
    expect(ok.body.receiptsGaps).toEqual([]);
  });

  it('requires a syndicate license for person issuers before enabling receipts', async () => {
    const ctx = await ownerCtx(app, `syn${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);
    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenant.update({
        where: { id: ctx.tenantId },
        data: { issuerType: 'P', syndicateLicenseNumber: null },
      }),
    );
    const list = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const main = list.body[0] as { id: string };

    const res = await request(app.getHttpServer())
      .patch(`/branches/${main.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: COMPLETE_ADDRESS,
      })
      .expect(400);
    expect(res.body.code).toBe('RECEIPT_BRANCH_INCOMPLETE');
    expect(res.body.gaps).toContain('MISSING_SYNDICATE_LICENSE');

    const ok = await request(app.getHttpServer())
      .patch(`/branches/${main.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: COMPLETE_ADDRESS,
        syndicateLicenseNumber: '123',
      })
      .expect(200);
    expect(ok.body.syndicateLicenseNumber).toBe('0000000123');
    expect(ok.body.receiptsReady).toBe(true);
  });
});
