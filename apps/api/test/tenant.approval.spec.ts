import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerUser(app: INestApplication, suffix: string) {
  const email = `pend_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  return { email, password, token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

describe('Tenant approval gate', () => {
  let app: INestApplication;
  let dbAvailable = true;
  const prev = process.env.SIGNUP_AUTO_APPROVE;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Tenant approval gate');
      return;
    }
    process.env.SIGNUP_AUTO_APPROVE = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    if (prev === undefined) delete process.env.SIGNUP_AUTO_APPROVE;
    else process.env.SIGNUP_AUTO_APPROVE = prev;
    if (app) await app.close();
  });

  it('new signup tenant is ACTIVE on trial and can write', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const user = await registerUser(app, String(t));

    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Trial Co ${t}`, planCode: 'STARTER' })
      .expect(201);

    expect(created.body.activationStatus).toBe('ACTIVE');
    const tenantId = created.body.id as string;

    const write = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ name: 'Second', etaBranchCode: '2', activityCode: '6201' });
    expect(write.status).not.toBe(403);
  });

  it('sub-company is blocked on trial (max 1 company) until a paid plan is assigned', async () => {
    if (!dbAvailable) return;
    const t = `sub${Date.now()}`;
    const user = await registerUser(app, t);
    const first = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Parent ${t}` })
      .expect(201);
    expect(first.body.activationStatus).toBe('ACTIVE');

    const blocked = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Child ${t}` });
    expect(blocked.status).toBe(409);

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });
    const assign = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${first.body.id}/plan`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ planCode: 'BRONZE', reason: 'upgrade' });
    expect([200, 201]).toContain(assign.status);

    const second = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Child ${t}` })
      .expect(201);
    expect(second.body.activationStatus).toBe('ACTIVE');
  });

  it('non-operators cannot hit platform-admin', async () => {
    if (!dbAvailable) return;
    const user = await registerUser(app, `nope${Date.now()}`);
    await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(403);
  });
});
