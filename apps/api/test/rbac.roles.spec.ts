import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PERMISSIONS } from '@einvoice/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { TenantService } from '../src/tenant/tenant.service';

describe('Roles & permissions management', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let tenants: TenantService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    tenants = app.get(TenantService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerOwner(suffix: string) {
    const password = 'Password123!';
    const email = `roles_owner_${suffix}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Owner' })
      .expect(201);
    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name: `Roles ${suffix}` })
      .expect(201);
    const token = (tenant.body.accessToken as string) ?? (reg.body.accessToken as string);
    return { email, password, token, tenantId: tenant.body.id as string };
  }

  it('new tenants grant customers.* to Owner/Admin/Accountant and expose the catalog', async () => {
    const suffix = `${Date.now()}`;
    const owner = await registerOwner(suffix);

    const catalog = await request(app.getHttpServer())
      .get('/permissions')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    expect(catalog.body.canManage).toBe(true);
    expect(catalog.body.codes).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(catalog.body.codes).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(catalog.body.groups.some((g: { id: string }) => g.id === 'customers')).toBe(
      true,
    );

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);

    const byName = Object.fromEntries(
      (roles.body as Array<{ name: string; permissions: string[] }>).map((r) => [
        r.name,
        r.permissions,
      ]),
    );
    expect(byName.Owner).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(byName.Admin).toContain(PERMISSIONS.CUSTOMERS_MANAGE);
    expect(byName.Accountant).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(byName.Viewer).toContain(PERMISSIONS.CUSTOMERS_VIEW);
    expect(byName.Viewer).not.toContain(PERMISSIONS.CUSTOMERS_MANAGE);

    await prisma.tenant.delete({ where: { id: owner.tenantId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: owner.email } });
  });

  it('Owner can CRUD custom roles, assign members, and cannot orphan or lock out Owner', async () => {
    const suffix = `${Date.now()}`;
    const owner = await registerOwner(suffix);
    const otherEmail = `roles_user_${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password: 'Password123!', name: 'User' })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({
        name: 'Sales',
        permissions: [PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.CUSTOMERS_VIEW],
      })
      .expect(201);
    expect(created.body.isSystem).toBe(false);
    expect(created.body.permissions).toEqual(
      expect.arrayContaining([PERMISSIONS.DOCUMENTS_VIEW, PERMISSIONS.CUSTOMERS_VIEW]),
    );

    const renamed = await request(app.getHttpServer())
      .patch(`/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ name: 'Sales desk' })
      .expect(200);
    expect(renamed.body.name).toBe('Sales desk');

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ email: otherEmail, roleId: created.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(409);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const viewer = roles.body.find((r: { name: string }) => r.name === 'Viewer');
    const ownerRole = roles.body.find((r: { name: string }) => r.name === 'Owner');

    await request(app.getHttpServer())
      .delete(`/roles/${created.body.id}`)
      .query({ reassignToRoleId: viewer.id })
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/roles/${ownerRole.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(400);

    const members = await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const self = members.body.find(
      (m: { user: { email: string } }) => m.user.email === owner.email,
    );
    await request(app.getHttpServer())
      .patch('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ membershipId: self.id, roleId: viewer.id })
      .expect(403);

    await prisma.tenant.delete({ where: { id: owner.tenantId } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { email: { in: [owner.email, otherEmail] } },
    });
  });

  it('cannot manage another tenant roles via header spoofing', async () => {
    const suffix = `${Date.now()}`;
    const a = await registerOwner(`a_${suffix}`);
    const b = await registerOwner(`b_${suffix}`);

    const bRoles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .expect(200);
    const bViewer = bRoles.body.find((r: { name: string }) => r.name === 'Viewer');

    await request(app.getHttpServer())
      .patch(`/roles/${bViewer.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .send({ permissions: [PERMISSIONS.DOCUMENTS_VIEW] })
      .expect(403);

    await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send({
        name: 'Cross',
        permissions: [PERMISSIONS.DOCUMENTS_VIEW],
      })
      .expect(201);

    const aRoles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(200);
    expect(aRoles.body.some((r: { name: string }) => r.name === 'Cross')).toBe(true);
    expect(bRoles.body.some((r: { name: string }) => r.name === 'Cross')).toBe(false);

    await tenantPrisma.withTenant(b.tenantId, async (tx) => {
      const names = (await tx.role.findMany()).map((r) => r.name);
      expect(names).not.toContain('Cross');
    });

    await prisma.tenant.delete({ where: { id: a.tenantId } }).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: b.tenantId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { in: [a.email, b.email] } } });
  });

  it('additive sync restores missing customers.view on system Admin without wiping data', async () => {
    const suffix = `${Date.now()}`;
    const owner = await registerOwner(suffix);

    const admin = await tenantPrisma.withTenant(owner.tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { tenantId: owner.tenantId, name: 'Admin', isSystem: true },
      });
      const perm = await tx.permission.findUnique({
        where: { code: PERMISSIONS.CUSTOMERS_VIEW },
      });
      expect(role && perm).toBeTruthy();
      await tx.rolePermission.deleteMany({
        where: { tenantId: owner.tenantId, roleId: role!.id, permissionId: perm!.id },
      });
      return role!;
    });

    await tenants.ensurePermissionCatalog();
    await tenants.syncTenantSystemRolePermissions(owner.tenantId);

    await tenantPrisma.withTenant(owner.tenantId, async (tx) => {
      const perm = await tx.permission.findUnique({
        where: { code: PERMISSIONS.CUSTOMERS_VIEW },
      });
      const row = await tx.rolePermission.findFirst({
        where: {
          tenantId: owner.tenantId,
          roleId: admin.id,
          permissionId: perm!.id,
        },
      });
      expect(row).toBeTruthy();
      const users = await tx.membership.count();
      expect(users).toBeGreaterThan(0);
    });

    await prisma.tenant.delete({ where: { id: owner.tenantId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: owner.email } });
  });

  it('Viewer cannot create roles', async () => {
    const suffix = `${Date.now()}`;
    const owner = await registerOwner(suffix);
    const viewerEmail = `roles_viewer_${suffix}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: viewerEmail, password: 'Password123!' })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'Viewer');

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ email: viewerEmail, roleId: viewerRole.id })
      .expect(201);

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: viewerEmail, password: 'Password123!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/tenants/switch')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .send({ tenantId: owner.tenantId })
      .expect(200)
      .then(async (switched) => {
        const token = switched.body.accessToken as string;
        await request(app.getHttpServer())
          .post('/roles')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-Id', owner.tenantId)
          .send({ name: 'Nope', permissions: [PERMISSIONS.DOCUMENTS_VIEW] })
          .expect(403);
      });

    await prisma.tenant.delete({ where: { id: owner.tenantId } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { email: { in: [owner.email, viewerEmail] } },
    });
  });
});
