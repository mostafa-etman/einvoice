import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { PLAN_HAS_SUBSCRIBERS_CODE } from '../src/platform-admin/plan-has-subscribers';

async function operatorWithToken(app: INestApplication, suffix: string) {
  const email = `plandel_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'Plan Delete Op' })
    .expect(201);
  const prisma = app.get(PrismaService);
  await prisma.user.update({
    where: { id: reg.body.user.id as string },
    data: { isPlatformOperator: true },
  });
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

function planPayload(code: string) {
  return {
    code,
    nameEn: 'Delete Test',
    nameAr: 'حذف',
    documentQuota: 10,
    branchQuota: 1,
    deviceQuota: 1,
    includedPoints: 0,
    officialPriceEgp: 0,
    discountedPriceEgp: 0,
    maxUsers: 1,
    maxCompanies: 1,
    isPublic: false,
    isActive: true,
    sortOrder: 99,
  };
}

describe('Platform admin plan delete', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Platform admin plan delete');
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

  it('deletes a plan with zero subscribers and blocks a plan that has any', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const op = await operatorWithToken(app, String(t));
    const emptyCode = `DEL0${String(t).slice(-8)}`;
    const usedCode = `DEL1${String(t).slice(-8)}`;

    await request(app.getHttpServer())
      .post('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .send(planPayload(emptyCode))
      .expect((res) => expect([200, 201]).toContain(res.status));

    await request(app.getHttpServer())
      .post('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .send(planPayload(usedCode))
      .expect((res) => expect([200, 201]).toContain(res.status));

    const listedBefore = await request(app.getHttpServer())
      .get('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .expect(200);
    const emptyRow = (
      listedBefore.body.plans as Array<{ code: string; subscriberCount: number }>
    ).find((p) => p.code === emptyCode);
    expect(emptyRow?.subscriberCount).toBe(0);

    await request(app.getHttpServer())
      .delete(`/platform-admin/plans/${emptyCode}`)
      .set('Authorization', `Bearer ${op.token}`)
      .expect(200);

    const gone = await request(app.getHttpServer())
      .get('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .expect(200);
    expect(
      (gone.body.plans as Array<{ code: string }>).some((p) => p.code === emptyCode),
    ).toBe(false);

    const owner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `plandel_sub_${t}@example.com`, password: 'Password123!' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${owner.body.accessToken}`)
      .send({ name: `Plan Del Co ${t}`, planCode: usedCode })
      .expect(201);

    const listedUsed = await request(app.getHttpServer())
      .get('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .expect(200);
    const usedRow = (
      listedUsed.body.plans as Array<{ code: string; subscriberCount: number; isActive: boolean }>
    ).find((p) => p.code === usedCode);
    expect(usedRow?.subscriberCount).toBeGreaterThanOrEqual(1);

    const blocked = await request(app.getHttpServer())
      .delete(`/platform-admin/plans/${usedCode}`)
      .set('Authorization', `Bearer ${op.token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe(PLAN_HAS_SUBSCRIBERS_CODE);
    expect(blocked.body.subscriberCount).toBeGreaterThanOrEqual(1);
    expect(blocked.body.messageAr).toContain('لا يمكن حذف الخطة لوجود مشتركين فيها');
    expect(blocked.body.messageEn).toContain('Cannot delete a plan that has active subscribers');
    expect(blocked.body.messageAr).toContain(`(${blocked.body.subscriberCount} حساب)`);
    expect(blocked.body.messageEn).toContain(`(${blocked.body.subscriberCount} accounts)`);

    const stillThere = await request(app.getHttpServer())
      .get('/platform-admin/plans')
      .set('Authorization', `Bearer ${op.token}`)
      .expect(200);
    expect(
      (stillThere.body.plans as Array<{ code: string }>).some((p) => p.code === usedCode),
    ).toBe(true);

    const hidden = await request(app.getHttpServer())
      .patch(`/platform-admin/plans/${usedCode}`)
      .set('Authorization', `Bearer ${op.token}`)
      .send({ isActive: false });
    expect([200, 201]).toContain(hidden.status);
    expect(hidden.body.isActive).toBe(false);
  });
});
