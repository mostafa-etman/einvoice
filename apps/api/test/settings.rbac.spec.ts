import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Settings RBAC', () => {
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

  it('Viewer is denied currencies/ETA/item manage and ETA view', async () => {
    const suffix = Date.now();
    const ownerEmail = `own_rbac_${suffix}@example.com`;
    const viewerEmail = `view_rbac_${suffix}@example.com`;
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
      .send({ name: `RBAC ${suffix}` })
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

    const denied = [
      ['get', '/currencies'],
      ['post', '/currencies'],
      ['get', '/settings/eta-credentials'],
      ['put', '/settings/eta-credentials'],
      ['get', '/item-codes'],
      ['post', '/item-codes'],
    ] as const;

    for (const [method, path] of denied) {
      const req = request(app.getHttpServer())[method](path)
        .set('Authorization', `Bearer ${viewerReg.body.accessToken}`)
        .set('X-Tenant-Id', tenant.body.id);
      if (method === 'post' || method === 'put') {
        await req.send({ currencyCode: 'EGP', clientId: 'x', type: 'EGS', code: '1', description: 'd' }).expect(403);
      } else {
        await req.expect(403);
      }
    }

    await prisma.user.delete({ where: { email: ownerEmail } }).catch(() => undefined);
    await prisma.user.delete({ where: { email: viewerEmail } }).catch(() => undefined);
  });
});
