import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('RBAC members/roles API', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows Owner members.manage and denies Viewer', async () => {
    const suffix = Date.now();
    const password = 'Password123!';
    const ownerEmail = `owner_${suffix}@example.com`;
    const viewerEmail = `viewer_${suffix}@example.com`;

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: viewerEmail, password })
      .expect(201);

    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ name: `RBAC ${suffix}` })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .expect(200);

    expect(roles.body.some((r: { name: string }) => r.name === 'Owner')).toBe(true);
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'Viewer');
    expect(viewerRole).toBeTruthy();

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .send({ email: viewerEmail, roleId: viewerRole.id })
      .expect(201);

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: viewerEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .expect(200);

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .send({ email: `other_${suffix}@example.com`, roleId: viewerRole.id })
      .expect(403);

    await prisma.tenant.delete({ where: { id: tenant.body.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, viewerEmail] } },
    });
  });
});
