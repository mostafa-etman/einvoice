import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PLATFORM_AUDIT_ACTIONS } from '../src/platform-admin/platform-audit';

async function operatorCtx(app: INestApplication, suffix: string) {
  const email = `plat_op_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const prisma = app.get(PrismaService);
  await prisma.user.update({
    where: { id: reg.body.user.id },
    data: { isPlatformOperator: true },
  });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

async function auditRows(app: INestApplication, tenantId: string, action: string) {
  const tenantPrisma = app.get(TenantPrismaService);
  return tenantPrisma.withTenant(tenantId, (tx) =>
    tx.auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } }),
  );
}

describe('Platform-admin audit trail (T061) — every lifecycle action is audited with before/after', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Platform-admin audit');
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

  it('provision / suspend / activate / plan+quota-override each write a distinct audited row', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const operator = await operatorCtx(app, String(t));
    const ownerEmail = `plat_owner_${t}@example.com`;

    const provisioned = await request(app.getHttpServer())
      .post('/platform-admin/tenants')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({
        name: `Platform Tenant ${t}`,
        ownerEmail,
        ownerName: 'Owner Name',
        planCode: 'FREE',
        reason: 'test: provision',
      })
      .expect(201);
    const tenantId = provisioned.body.id as string;
    expect(provisioned.body.planCode).toBe('FREE');

    const provisionRows = await auditRows(app, tenantId, PLATFORM_AUDIT_ACTIONS.TENANT_PROVISION);
    expect(provisionRows).toHaveLength(1);
    expect(provisionRows[0]).toMatchObject({
      outcome: 'success',
      actorUserId: operator.userId,
      resourceType: 'tenant',
      resourceId: tenantId,
    });
    expect(provisionRows[0]!.metadata).toMatchObject({
      ownerEmail,
      planCode: 'FREE',
      reason: 'test: provision',
    });

    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantId}/suspend`)
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ reason: 'test: suspend for non-payment' })
      .expect(201);

    const suspendRows = await auditRows(app, tenantId, PLATFORM_AUDIT_ACTIONS.TENANT_SUSPEND);
    expect(suspendRows).toHaveLength(1);
    expect(suspendRows[0]).toMatchObject({ outcome: 'success', actorUserId: operator.userId });
    expect(suspendRows[0]!.metadata).toMatchObject({ reason: 'test: suspend for non-payment' });

    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantId}/activate`)
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ reason: 'test: reactivate' })
      .expect(201);

    const activateRows = await auditRows(app, tenantId, PLATFORM_AUDIT_ACTIONS.TENANT_ACTIVATE);
    expect(activateRows).toHaveLength(1);
    expect(activateRows[0]).toMatchObject({ outcome: 'success', actorUserId: operator.userId });

    const planRes = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantId}/plan`)
      .set('Authorization', `Bearer ${operator.token}`)
      .send({
        planCode: 'PRO',
        documentQuota: 12345,
        branchQuota: 7,
        deviceQuota: 9,
        reason: 'test: manual plan + override',
      })
      .expect(201);
    expect(planRes.body.entitlements.documentQuota).toBe(12345);
    expect(planRes.body.entitlements.branchQuota).toBe(7);
    expect(planRes.body.entitlements.deviceQuota).toBe(9);

    const planRows = await auditRows(app, tenantId, PLATFORM_AUDIT_ACTIONS.PLAN_ASSIGN);
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.metadata).toMatchObject({ planCode: 'PRO', reason: 'test: manual plan + override' });

    const overrideRows = await auditRows(app, tenantId, PLATFORM_AUDIT_ACTIONS.QUOTA_OVERRIDE);
    expect(overrideRows).toHaveLength(1);
    expect(overrideRows[0]).toMatchObject({ outcome: 'success', actorUserId: operator.userId });
    const metadata = overrideRows[0]!.metadata as {
      before: { documentQuota: number; branchQuota: number; deviceQuota: number };
      after: { documentQuota: number; branchQuota: number; deviceQuota: number };
      reason: string;
    };
    // Before is the pre-override Free entitlement; after reflects the just-applied override.
    expect(metadata.before).toMatchObject({ documentQuota: 100, branchQuota: 1, deviceQuota: 1 });
    expect(metadata.after).toMatchObject({ documentQuota: 12345, branchQuota: 7, deviceQuota: 9 });
    expect(metadata.reason).toBe('test: manual plan + override');
  });

  it('a non-operator is refused platform-admin access entirely', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const email = `plat_reg_${t}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Password123!' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(403);
  });
});
