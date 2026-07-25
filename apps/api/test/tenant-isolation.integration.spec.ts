import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PERMISSIONS } from '@einvoice/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

/**
 * DEDICATED cross-tenant RLS isolation test.
 * Asserts DB-layer policies (SET LOCAL) — not merely app where filters.
 */
describe('Cross-tenant RLS isolation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tenant A SET LOCAL cannot read tenant B rows on every RLS table', async () => {
    const suffix = Date.now();
    const emailA = `a_${suffix}@example.com`;
    const emailB = `b_${suffix}@example.com`;
    const password = 'Password123!';

    const regA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailA, password })
      .expect(201);
    const regB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailB, password })
      .expect(201);

    const tenantARes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .send({ name: `Tenant A ${suffix}` })
      .expect(201);

    const tenantBRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .send({ name: `Tenant B ${suffix}` })
      .expect(201);

    const tenantA = tenantARes.body;
    const tenantB = tenantBRes.body;

    // DB-layer: under tenant A GUC, zero B rows (no Prisma tenantId filter)
    await tenantPrisma.withTenant(tenantA.id, async (tx) => {
      const branches = await tx.branch.findMany();
      expect(branches.every((b) => b.tenantId === tenantA.id)).toBe(true);
      expect(branches.some((b) => b.tenantId === tenantB.id)).toBe(false);

      const roles = await tx.role.findMany();
      expect(roles.every((r) => r.tenantId === tenantA.id)).toBe(true);
      expect(roles.some((r) => r.tenantId === tenantB.id)).toBe(false);

      const rolePerms = await tx.rolePermission.findMany();
      expect(rolePerms.every((rp) => rp.tenantId === tenantA.id)).toBe(true);
      expect(rolePerms.some((rp) => rp.tenantId === tenantB.id)).toBe(false);

      const memberships = await tx.membership.findMany();
      expect(memberships.every((m) => m.tenantId === tenantA.id)).toBe(true);
      expect(memberships.some((m) => m.tenantId === tenantB.id)).toBe(false);

      const audits = await tx.auditLog.findMany({
        where: { tenantId: { not: null } },
      });
      expect(audits.every((a) => a.tenantId === tenantA.id || a.tenantId === null)).toBe(
        true,
      );
      expect(audits.some((a) => a.tenantId === tenantB.id)).toBe(false);
    });

    // HTTP: list members as A never returns B
    const membersA = await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    expect(
      membersA.body.every((m: { user: { email: string } }) => m.user.email === emailA),
    ).toBe(true);

    // RBAC: Viewer cannot manage members
    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    const viewer = roles.body.find((r: { name: string }) => r.name === 'Viewer');
    expect(viewer).toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `viewer_${suffix}@example.com`, password })
      .expect(201);

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({ email: `viewer_${suffix}@example.com`, roleId: viewer.id })
      .expect(201);

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `viewer_${suffix}@example.com`, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({ email: emailB, roleId: viewer.id })
      .expect(403);

    expect(PERMISSIONS.MEMBERS_MANAGE).toBe('members.manage');

    // cleanup tenants (cascade)
    await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [emailA, emailB, `viewer_${suffix}@example.com`],
        },
      },
    });
  });
});
