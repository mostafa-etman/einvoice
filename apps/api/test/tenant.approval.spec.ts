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

  it('new signup tenant is PENDING and cannot write until approved', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const user = await registerUser(app, String(t));

    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Pending Co ${t}`, planCode: 'STARTER' })
      .expect(201);

    expect(created.body.activationStatus).toBe('PENDING');
    const tenantId = created.body.id as string;

    const blocked = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ name: 'Second', etaBranchCode: '2', activityCode: '6201' })
      .expect(403);
    expect(blocked.body.message).toBe('tenant_pending_approval');

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });

    const approveRes = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${tenantId}/approve`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ reason: 'test approve' });
    expect([200, 201]).toContain(approveRes.status);

    const approved = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(approved.body.activationStatus).toBe('ACTIVE');
    expect(approved.body.lifecycleStatus).toBe('ACTIVE');

    // Writes work after approval (may 409 quota on second branch — not 403 pending).
    const write = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ name: 'Second', etaBranchCode: '2', activityCode: '6201' });
    expect(write.status).not.toBe(403);
  });

  it('sub-company created by an approved owner is auto-active', async () => {
    if (!dbAvailable) return;
    const t = `sub${Date.now()}`;
    const user = await registerUser(app, t);
    const first = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Parent ${t}` })
      .expect(201);
    expect(first.body.activationStatus).toBe('PENDING');

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: user.userId },
      data: { isPlatformOperator: true },
    });
    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${first.body.id}/approve`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ reason: 'parent' });

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
