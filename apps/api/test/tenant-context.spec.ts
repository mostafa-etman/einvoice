import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Tenant context header', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let tenantId: string;
  const email = `ctx_${Date.now()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    accessToken = reg.body.accessToken;

    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Ctx ${Date.now()}` })
      .expect(201);
    tenantId = tenant.body.id;
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.user.delete({ where: { email } }).catch(() => undefined);
    await app.close();
  });

  it('rejects tenant-scoped routes without X-Tenant-Id', async () => {
    await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('accepts tenant-scoped routes with X-Tenant-Id', async () => {
    await request(app.getHttpServer())
      .get('/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Tenant-Id', tenantId)
      .expect(200);
  });
});
