import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

describe('Tenant screen feedback', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Tenant screen feedback');
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

  it('lets a tenant admin submit notes and keeps them isolated from other tenants', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const password = 'Password123!';

    const ownerA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `fb_a_${t}@example.com`, password, name: 'Owner A' })
      .expect(201);
    const ownerB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `fb_b_${t}@example.com`, password, name: 'Owner B' })
      .expect(201);
    const viewerA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `fb_a_view_${t}@example.com`, password, name: 'Viewer A' })
      .expect(201);

    const tenantA = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${ownerA.body.accessToken}`)
        .send({ name: `Feedback Co A ${t}` })
        .expect(201)
    ).body;
    const tenantB = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${ownerB.body.accessToken}`)
        .send({ name: `Feedback Co B ${t}` })
        .expect(201)
    ).body;
    const tokenA = tenantA.accessToken ?? ownerA.body.accessToken;
    const tokenB = tenantB.accessToken ?? ownerB.body.accessToken;

    const rolesA = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    const viewerRole = (rolesA.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === 'Viewer',
    );
    expect(viewerRole).toBeTruthy();
    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({ email: `fb_a_view_${t}@example.com`, roleId: viewerRole!.id })
      .expect(201);

    const submitted = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({
        screenKey: 'documents',
        routePath: '/en/documents',
        note: 'The documents list needs a denser table.',
      })
      .expect(201);
    expect(submitted.body.tenantId).toBe(tenantA.id);
    expect(submitted.body.screenKey).toBe('documents');
    expect(submitted.body.status).toBe('NEW');
    expect(submitted.body.routePath).toBe('/documents');

    await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${viewerA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({ screenKey: 'home', routePath: '/en', note: 'viewer should not post' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/platform-admin/feedback')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: ownerA.body.user.id },
      data: { isPlatformOperator: true },
    });

    const listed = await request(app.getHttpServer())
      .get('/platform-admin/feedback')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(listed.body.items.some((row: { id: string }) => row.id === submitted.body.id)).toBe(
      true,
    );

    const tenantPrisma = app.get(TenantPrismaService);
    const seenByB = await tenantPrisma.withTenant(tenantB.id, (tx) =>
      tx.tenantScreenFeedback.findMany({ where: { tenantId: tenantA.id } }),
    );
    expect(seenByB).toEqual([]);

    const seenByA = await tenantPrisma.withTenant(tenantA.id, (tx) =>
      tx.tenantScreenFeedback.findMany(),
    );
    expect(seenByA.some((row) => row.id === submitted.body.id)).toBe(true);

    const updated = await request(app.getHttpServer())
      .patch(`/platform-admin/feedback/${submitted.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'REVIEWED' })
      .expect(200);
    expect(updated.body.status).toBe('REVIEWED');
  });
});
