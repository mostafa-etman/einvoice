import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PointsService } from '../src/billing/points.service';
import { InsufficientPointsHttpException } from '../src/billing/points-errors';

async function operatorAndTenant(app: INestApplication, suffix: string) {
  const email = `pts_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const prisma = app.get(PrismaService);
  await prisma.user.update({
    where: { id: reg.body.user.id },
    data: { isPlatformOperator: true },
  });
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Points ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
    userId: reg.body.user.id as string,
  };
}

describe('Points / credits for document send', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Points enforce');
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

  it('blocks send when balance is below cost and deducts when funded', async () => {
    if (!dbAvailable) return;
    const ctx = await operatorAndTenant(app, String(Date.now()));
    const points = app.get(PointsService);
    const tenantPrisma = app.get(TenantPrismaService);

    await request(app.getHttpServer())
      .put(`/platform-admin/tenants/${ctx.tenantId}/document-costs`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ items: [{ documentKind: 'INVOICE', points: 4 }, { documentKind: 'RECEIPT', points: 2 }] })
      .expect(200);

    await expect(
      tenantPrisma.withTenant(ctx.tenantId, (tx) =>
        points.consumeForSendInTx(tx, {
          tenantId: ctx.tenantId,
          kinds: ['INVOICE'],
          documentIds: ['00000000-0000-4000-8000-000000000001'],
          actorUserId: ctx.userId,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientPointsHttpException);

    const topUp = await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${ctx.tenantId}/points`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({ delta: 10, note: 'test top-up' });
    expect([200, 201]).toContain(topUp.status);

    const snap = await request(app.getHttpServer())
      .get(`/platform-admin/tenants/${ctx.tenantId}/points`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .expect(200);
    expect(snap.body.pointsBalance).toBeGreaterThanOrEqual(10);

    const result = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      points.consumeForSendInTx(tx, {
        tenantId: ctx.tenantId,
        kinds: ['INVOICE', 'RECEIPT'],
        documentIds: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
        ],
        actorUserId: ctx.userId,
      }),
    );
    expect(result.total).toBe(6);
    expect(result.balanceAfter).toBe(snap.body.pointsBalance - 6);
  });
});
