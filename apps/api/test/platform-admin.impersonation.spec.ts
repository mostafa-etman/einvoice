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
  const email = `imp_op_${suffix}@example.com`;
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

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `imp_owner_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Impersonated ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
    userId: reg.body.user.id as string,
  };
}

async function actionAuditRows(app: INestApplication, tenantId: string) {
  const tenantPrisma = app.get(TenantPrismaService);
  return tenantPrisma.withTenant(tenantId, (tx) =>
    tx.auditLog.findMany({
      where: { tenantId, action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_ACTION },
      orderBy: { createdAt: 'asc' },
    }),
  );
}

/** The impersonation-action audit write is fire-and-forget (never blocks the
 * response), so assertions against it must tolerate a short async delay. */
async function waitForAuditRow(
  app: INestApplication,
  tenantId: string,
  predicate: (row: { metadata: unknown; outcome: string }) => boolean,
  timeoutMs = 2000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await actionAuditRows(app, tenantId);
    const match = rows.find(predicate);
    if (match) return match;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Platform-admin impersonation (T076/T077) — read-only by default, break-glass for writes, expiry enforced', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Platform-admin impersonation');
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

  it('start (READ_ONLY) → GET succeeds + audits; POST refused; break-glass → POST succeeds + audits; expiry refuses', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const operator = await operatorCtx(app, String(t));
    const owner = await ownerCtx(app, String(t));

    const started = await request(app.getHttpServer())
      .post('/platform-admin/impersonation')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ tenantId: owner.tenantId, targetUserId: owner.userId, reason: 'test: support ticket #1' })
      .expect(201);

    expect(started.body.mode).toBe('READ_ONLY');
    const sessionId = started.body.id as string;
    let impersonationToken = started.body.accessToken as string;

    // READ under impersonation succeeds and is fully audited (no sampling).
    const listed = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const mainBranchId = listed.body[0].id as string;

    const successRow = await waitForAuditRow(
      app,
      owner.tenantId,
      (r) => r.outcome === 'success' && (r.metadata as { method?: string })?.method === 'GET',
    );
    expect(successRow).toBeDefined();
    expect(successRow).toMatchObject({ outcome: 'success', actorUserId: operator.userId });
    expect(successRow!.metadata).toMatchObject({ method: 'GET', mode: 'READ_ONLY' });

    // WRITE under READ_ONLY mode is refused (PATCH, not create, to stay clear of
    // the branch-quota gate) — and the denial itself is audited.
    await request(app.getHttpServer())
      .patch(`/branches/${mainBranchId}`)
      .set('Authorization', `Bearer ${impersonationToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ name: 'Blocked Rename' })
      .expect(403);

    const denied = await waitForAuditRow(
      app,
      owner.tenantId,
      (r) => Boolean((r.metadata as { denied?: boolean })?.denied),
    );
    expect(denied).toBeDefined();
    expect(denied?.outcome).toBe('failure');

    // Break-glass (only the operator who started the session may escalate it).
    const brokeGlass = await request(app.getHttpServer())
      .post(`/platform-admin/impersonation/${sessionId}/break-glass`)
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ reason: 'test: customer authorized a fix' })
      .expect(201);
    expect(brokeGlass.body.mode).toBe('WRITE');
    impersonationToken = brokeGlass.body.accessToken as string;

    const tenantPrisma = app.get(TenantPrismaService);
    const bgRows = await tenantPrisma.withTenant(owner.tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: owner.tenantId, action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_BREAK_GLASS },
      }),
    );
    expect(bgRows).toHaveLength(1);

    // WRITE now succeeds under WRITE mode, and every write is still audited.
    const updated = await request(app.getHttpServer())
      .patch(`/branches/${mainBranchId}`)
      .set('Authorization', `Bearer ${impersonationToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ name: 'Allowed Rename' })
      .expect(200);
    expect(updated.body.name).toBe('Allowed Rename');

    const writeRow = await waitForAuditRow(
      app,
      owner.tenantId,
      (r) => (r.metadata as { method?: string })?.method === 'PATCH' && r.outcome === 'success',
    );
    expect(writeRow).toBeDefined();

    // Expire the session directly, then prove the very next request is refused.
    const tenantPrismaSvc = app.get(TenantPrismaService);
    await tenantPrismaSvc.withPlatformOperator((tx) =>
      tx.impersonationSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(403);

    const deadline = Date.now() + 2000;
    let expireRows: Array<{ id: string }> = [];
    do {
      expireRows = await tenantPrisma.withTenant(owner.tenantId, (tx) =>
        tx.auditLog.findMany({
          where: { tenantId: owner.tenantId, action: PLATFORM_AUDIT_ACTIONS.IMPERSONATION_EXPIRE },
        }),
      );
      if (expireRows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    expect(expireRows.length).toBeGreaterThanOrEqual(1);
  });
});
