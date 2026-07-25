import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('ETA RBAC (mocked)', () => {
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

  it('Viewer cannot Test Connection or refresh document types', async () => {
    const suffix = Date.now();
    const ownerEmail = `eta_own_${suffix}@example.com`;
    const viewerEmail = `eta_view_${suffix}@example.com`;
    const password = 'Password123!';

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password })
      .expect(201);
    const viewerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: viewerEmail, password })
      .expect(201);

    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .send({ name: `ETA RBAC ${suffix}` })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .expect(200);
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'Viewer');

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${ownerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .send({ email: viewerEmail, roleId: viewerRole.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/settings/eta-credentials/test-connection')
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .get('/settings/eta/document-types?refresh=true')
      .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .expect(403);

    await prisma.user.delete({ where: { email: ownerEmail } }).catch(() => undefined);
    await prisma.user.delete({ where: { email: viewerEmail } }).catch(() => undefined);
  });
});
