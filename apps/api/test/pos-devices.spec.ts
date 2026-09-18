import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `pos_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `POS ${suffix}` })
    .expect(201);
  const tenantId = tenant.body.id as string;
  const userId = reg.body.user.id as string;
  const tenantPrisma = app.get(TenantPrismaService);
  await tenantPrisma.withTenant(tenantId, (tx) =>
    tx.quotaOverride.create({
      data: {
        tenantId,
        deviceQuota: 10,
        reason: 'test: POS devices suite',
        createdByUserId: userId,
      },
    }),
  );
  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  return {
    token: reg.body.accessToken as string,
    tenantId,
    branchId: branches.body[0].id as string,
  };
}

describe('POS devices API', () => {
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

  it('lets a tenant register, mask PSK, retire, and never leak another tenant POS', async () => {
    const a = await ownerCtx(app, `a${Date.now()}`);
    const b = await ownerCtx(app, `b${Date.now()}`);

    const created = await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({
        branchId: a.branchId,
        label: 'Till 1',
        serialNumber: `SN-${Date.now()}`,
        osVersion: 'Windows 10',
        modelFramework: '1',
        preSharedKey: 'psk-secret-value',
      })
      .expect(201);

    expect(created.body.serialNumber).toMatch(/^SN-/);
    expect(created.body.hasPreSharedKey).toBe(true);
    expect(created.body.preSharedKeyMasked).toBe('••••••••');
    expect(created.body.lastReceiptUuid).toBe('');
    expect(JSON.stringify(created.body)).not.toContain('psk-secret-value');
    expect(created.body.status).toBe('ACTIVE');

    const listed = await request(app.getHttpServer())
      .get('/pos-devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(200);
    expect(listed.body).toHaveLength(1);

    const other = await request(app.getHttpServer())
      .get('/pos-devices')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .expect(200);
    expect(other.body).toHaveLength(0);

    await request(app.getHttpServer())
      .get('/pos-devices')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });

    const retired = await request(app.getHttpServer())
      .patch(`/pos-devices/${created.body.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({ status: 'RETIRED' })
      .expect(200);
    expect(retired.body.status).toBe('RETIRED');
    expect(retired.body.retiredAt).toBeTruthy();
  });

  it('refuses a POS on another tenant branch and duplicate serials', async () => {
    const a = await ownerCtx(app, `dup${Date.now()}`);
    const b = await ownerCtx(app, `dupb${Date.now()}`);
    const serial = `DUP-${Date.now()}`;

    await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({
        branchId: b.branchId,
        serialNumber: serial,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({
        branchId: a.branchId,
        serialNumber: serial,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({
        branchId: a.branchId,
        serialNumber: serial,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key-2',
      })
      .expect(409);
  });

  it('counts an unlinked active POS against the account device quota', async () => {
    const ctx = await ownerCtx(app, `q${Date.now()}`);
    const tenantPrisma = app.get(TenantPrismaService);
    await tenantPrisma.withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.quotaOverride.findFirst({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await tx.quotaOverride.update({
          where: { id: existing.id },
          data: { deviceQuota: 1 },
        });
      }
    });

    await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        branchId: ctx.branchId,
        serialNumber: `Q1-${Date.now()}`,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key',
      })
      .expect(201);

    const refused = await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        branchId: ctx.branchId,
        serialNumber: `Q2-${Date.now()}`,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key',
      })
      .expect(409);
    expect(refused.body.code).toBe('QUOTA_EXCEEDED');
    expect(refused.body.resource).toBe('devices');
  });

  it('locks serial after a receipt UUID is recorded and blocks reactivation of a permanently retired POS', async () => {
    const ctx = await ownerCtx(app, `lock${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        branchId: ctx.branchId,
        serialNumber: `LOCK-${Date.now()}`,
        osVersion: 'os',
        modelFramework: '1',
        preSharedKey: 'key',
      })
      .expect(201);

    const tenantPrisma = app.get(TenantPrismaService);
    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.posDevice.update({
        where: { id: created.body.id },
        data: { lastReceiptUuid: 'abc'.repeat(16).slice(0, 64) },
      }),
    );

    const locked = await request(app.getHttpServer())
      .patch(`/pos-devices/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ serialNumber: 'CHANGED' })
      .expect(400);
    expect(locked.body.code).toBe('POS_SERIAL_LOCKED');

    await request(app.getHttpServer())
      .patch(`/pos-devices/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ status: 'PERMANENTLY_RETIRED' })
      .expect(200);

    const revive = await request(app.getHttpServer())
      .patch(`/pos-devices/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ status: 'ACTIVE' })
      .expect(400);
    expect(revive.body.code).toBe('POS_PERMANENTLY_RETIRED');
  });
});
