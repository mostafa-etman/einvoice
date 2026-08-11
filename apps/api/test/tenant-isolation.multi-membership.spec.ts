import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Same login (one email) belonging to companies A and B:
 * session switch re-binds tenant server-side; A context never sees B data.
 */
describe('Multi-company membership isolation', () => {
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

  it('user in A and B sees only the active tenant; cannot forge another', async () => {
    const suffix = Date.now();
    const password = 'Password123!';
    const emailU = `multi_u_${suffix}@example.com`;
    const emailO = `multi_o_${suffix}@example.com`;
    const emailC = `multi_c_${suffix}@example.com`;

    const regU = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailU, password, name: 'Shared User' })
      .expect(201);
    const regO = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailO, password, name: 'Owner B' })
      .expect(201);
    const regC = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: emailC, password, name: 'Owner C' })
      .expect(201);

    const tenantA = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regU.body.accessToken}`)
        .send({ name: `Company A ${suffix}` })
        .expect(201)
    ).body as { id: string; name: string; accessToken?: string };

    const tenantB = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regO.body.accessToken}`)
        .send({ name: `Company B ${suffix}` })
        .expect(201)
    ).body as { id: string; accessToken?: string };

    const tenantC = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regC.body.accessToken}`)
        .send({ name: `Company C ${suffix}` })
        .expect(201)
    ).body as { id: string };

    const tokenAOwner = (tenantA.accessToken as string) ?? (regU.body.accessToken as string);
    const tokenBOwner = (tenantB.accessToken as string) ?? (regO.body.accessToken as string);

    const rolesB = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${tokenBOwner}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(200);
    const adminB = rolesB.body.find((r: { name: string }) => r.name === 'Admin');
    expect(adminB).toBeTruthy();

    // Invite the existing user (same email) into company B with a different role.
    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${tokenBOwner}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({ email: emailU, roleId: adminB.id })
      .expect(201);

    const loginU = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailU, password })
      .expect(200);

    const mine = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${loginU.body.accessToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(2);
    const roleByTenant = new Map(
      mine.body.map((m: { tenant: { id: string }; role: { name: string } }) => [
        m.tenant.id,
        m.role.name,
      ]),
    );
    expect(roleByTenant.get(tenantA.id)).toBe('Owner');
    expect(roleByTenant.get(tenantB.id)).toBe('Admin');

    await seedDistinctData(app, tokenAOwner, tenantA.id, `A-${suffix}`);
    await seedDistinctData(app, tokenBOwner, tenantB.id, `B-${suffix}`);

    const switchedA = await request(app.getHttpServer())
      .post('/tenants/switch')
      .set('Authorization', `Bearer ${loginU.body.accessToken}`)
      .send({ tenantId: tenantA.id })
      .expect(200);
    const tokenInA = switchedA.body.accessToken as string;
    expect(switchedA.body.activeTenantId).toBe(tenantA.id);

    const docsA = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenInA}`)
      .expect(200);
    const idsA = (docsA.body.items as Array<{ internalId: string }>).map((d) => d.internalId);
    expect(idsA).toContain(`A-${suffix}`);
    expect(idsA).not.toContain(`B-${suffix}`);

    const branchesA = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${tokenInA}`)
      .expect(200);
    expect(branchesA.body.every((b: { tenantId?: string }) => !b.tenantId || b.tenantId === tenantA.id)).toBe(
      true,
    );

    const membersA = await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${tokenInA}`)
      .expect(200);
    const emailsA = membersA.body.map((m: { user: { email: string } }) => m.user.email);
    expect(emailsA).toContain(emailU);
    expect(emailsA).not.toContain(emailO);

    // Header cannot override the session tenant to B.
    await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenInA}`)
      .set('X-Tenant-Id', tenantB.id)
      .expect(403);

    const switchedB = await request(app.getHttpServer())
      .post('/tenants/switch')
      .set('Authorization', `Bearer ${tokenInA}`)
      .send({ tenantId: tenantB.id })
      .expect(200);
    const tokenInB = switchedB.body.accessToken as string;
    expect(switchedB.body.activeTenantId).toBe(tenantB.id);
    expect(switchedB.body.role.name).toBe('Admin');

    const docsB = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenInB}`)
      .expect(200);
    const idsB = (docsB.body.items as Array<{ internalId: string }>).map((d) => d.internalId);
    expect(idsB).toContain(`B-${suffix}`);
    expect(idsB).not.toContain(`A-${suffix}`);

    const membersB = await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${tokenInB}`)
      .expect(200);
    const emailsB = membersB.body.map((m: { user: { email: string } }) => m.user.email);
    expect(emailsB).toContain(emailU);
    expect(emailsB).toContain(emailO);

    const branchesB = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${tokenInB}`)
      .expect(200);
    const branchIdsB = new Set(branchesB.body.map((b: { id: string }) => b.id));
    expect(branchesA.body.some((b: { id: string }) => branchIdsB.has(b.id))).toBe(false);

    // Cannot switch to a company the user is not a member of.
    await request(app.getHttpServer())
      .post('/tenants/switch')
      .set('Authorization', `Bearer ${tokenInB}`)
      .send({ tenantId: tenantC.id })
      .expect(403);

    await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${tokenInB}`)
      .set('X-Tenant-Id', tenantC.id)
      .expect(403);

    await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${tokenInB}`)
      .set('X-Tenant-Id', tenantC.id)
      .expect(403);
  });
});

async function seedDistinctData(
  app: INestApplication,
  token: string,
  tenantId: string,
  internalId: string,
) {
  await request(app.getHttpServer())
    .post('/currencies')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ currencyCode: 'EGP', isDefault: true });

  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  const branchId = branches.body[0].id as string;

  await request(app.getHttpServer())
    .post('/item-codes')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ type: 'EGS', code: `EGS-${internalId}`, description: `Item ${internalId}` })
    .expect(201);

  await request(app.getHttpServer())
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({
      kind: 'INVOICE',
      branchId,
      currencyCode: 'EGP',
      issueDateTime: new Date().toISOString(),
      internalId,
      version: 0,
      receiver: { type: 'B', name: 'Buyer Co' },
      lines: [
        {
          description: 'Service',
          itemType: 'EGS',
          itemCode: `EGS-${internalId}`,
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
          discountAmount: '0.00',
          taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
        },
      ],
    })
    .expect(201);
}
