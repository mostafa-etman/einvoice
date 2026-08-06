import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Tenant A cannot see tenant B branches/users/item-codes', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    tenantPrisma = app.get(TenantPrismaService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('HTTP + RLS: A lists never include B branches, members, or item codes', async () => {
    const suffix = Date.now();
    const password = 'Password123!';

    const regA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `iso_br_a_${suffix}@example.com`, password, name: 'Owner A' })
      .expect(201);
    const regB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `iso_br_b_${suffix}@example.com`, password, name: 'Owner B' })
      .expect(201);

    const tenantA = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regA.body.accessToken}`)
        .send({ name: `Iso Branches A ${suffix}` })
        .expect(201)
    ).body;
    const tenantB = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regB.body.accessToken}`)
        .send({ name: `Iso Branches B ${suffix}` })
        .expect(201)
    ).body;

    // Seed distinctive B-only data (default Main branch already exists per tenant).
    await request(app.getHttpServer())
      .post('/item-codes')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({
        type: 'GS1',
        code: `B-ONLY-${suffix}`,
        description: 'Tenant B secret item',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `iso_br_b_member_${suffix}@example.com`,
        password,
        name: 'B Member',
      })
      .expect(201);

    const rolesB = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(200);
    const viewerB = rolesB.body.find((r: { name: string }) => r.name === 'Viewer');
    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({
        email: `iso_br_b_member_${suffix}@example.com`,
        roleId: viewerB.id,
      })
      .expect(201);

    const branchesB = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(200);
    const branchBIds = new Set(
      branchesB.body.map((b: { id: string }) => b.id),
    );
    expect(branchBIds.size).toBeGreaterThan(0);

    // --- As tenant A ---
    const branchesA = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    expect(
      branchesA.body.some((b: { id: string }) => branchBIds.has(b.id)),
    ).toBe(false);

    const membersA = await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    const emailsA = membersA.body.map(
      (m: { user: { email: string } }) => m.user.email,
    );
    expect(emailsA).toContain(`iso_br_a_${suffix}@example.com`);
    expect(emailsA).not.toContain(`iso_br_b_${suffix}@example.com`);
    expect(emailsA).not.toContain(`iso_br_b_member_${suffix}@example.com`);

    const itemsA = await request(app.getHttpServer())
      .get('/item-codes')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    expect(
      itemsA.body.some((i: { code: string }) => i.code === `B-ONLY-${suffix}`),
    ).toBe(false);

    // Spoofing B's tenant header as A must be denied (not a silent data leak).
    await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(403);
    await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(403);
    await request(app.getHttpServer())
      .get('/item-codes')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(403);

    // Members list is membership-scoped (not a global users dump).
    expect(membersA.body).toHaveLength(1);
    expect(membersA.body[0].user.email).toBe(`iso_br_a_${suffix}@example.com`);

    // DB-layer (no Prisma tenantId filter) under A GUC still excludes B.
    await tenantPrisma.withTenant(tenantA.id, async (tx) => {
      const branches = await tx.branch.findMany();
      expect(branches.some((b) => b.tenantId === tenantB.id)).toBe(false);
      expect(branches.every((b) => b.tenantId === tenantA.id)).toBe(true);
      const members = await tx.membership.findMany();
      expect(members.some((m) => m.tenantId === tenantB.id)).toBe(false);
      expect(members.every((m) => m.tenantId === tenantA.id)).toBe(true);
      const items = await tx.itemCode.findMany();
      expect(items.some((i) => i.tenantId === tenantB.id)).toBe(false);
      expect(items.every((i) => i.tenantId === tenantA.id)).toBe(true);
    });

    // Unscoped queries as einvoice_app return nothing (GUC unset).
    const role = await prisma.$queryRaw<
      Array<{ current_user: string; rolbypassrls: boolean }>
    >`SELECT current_user::text AS current_user, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`;
    expect(role[0]?.rolbypassrls).toBe(false);
    expect(await prisma.branch.findMany({ take: 5 })).toEqual([]);
    expect(await prisma.membership.findMany({ take: 5 })).toEqual([]);
    expect(await prisma.itemCode.findMany({ take: 5 })).toEqual([]);

    // users is a global identity table (no tenant_id / no RLS) — confirmed
    // intentional; listing tenants' people must go through memberships only.
    const userTable = await prisma.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'users'`;
    expect(userTable[0]?.relrowsecurity).toBe(false);
  });
});
