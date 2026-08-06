import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';

async function operatorCtx(app: INestApplication, suffix: string) {
  const email = `esc_op_${suffix}@example.com`;
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
  return { token: reg.body.accessToken as string, userId: reg.body.user.id as string };
}

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `esc_owner_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Escalation ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
    userId: reg.body.user.id as string,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Privilege-escalation GATE (T093): an impersonation-scoped credential must
 * NEVER be usable to reach the platform-operator console — regardless of
 * whether the impersonated target user happens to also be a platform operator.
 */
describe('Impersonation credentials cannot escalate to platform-admin (T093)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Impersonation escalation');
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

  it('the impersonation JWT never carries isPlatformOperator: true', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const operator = await operatorCtx(app, String(t));
    const owner = await ownerCtx(app, String(t));

    const started = await request(app.getHttpServer())
      .post('/platform-admin/impersonation')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ tenantId: owner.tenantId, targetUserId: owner.userId, reason: 'test: escalation gate' })
      .expect(201);

    const claims = decodeJwtPayload(started.body.accessToken as string);
    expect(claims.isPlatformOperator).toBe(false);
    expect(claims).not.toHaveProperty('platformOperator');
    expect(claims.sub).toBe(owner.userId);
  });

  it('the impersonated target being a platform operator does not matter — impersonation tokens are always refused', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const operator = await operatorCtx(app, `a${t}`);
    // The target itself is ALSO a platform operator — must not matter.
    const owner = await ownerCtx(app, `b${t}`);
    const prisma = app.get(PrismaService);
    await prisma.user.update({ where: { id: owner.userId }, data: { isPlatformOperator: true } });

    const started = await request(app.getHttpServer())
      .post('/platform-admin/impersonation')
      .set('Authorization', `Bearer ${operator.token}`)
      .send({ tenantId: owner.tenantId, targetUserId: owner.userId, reason: 'test: target is also operator' })
      .expect(201);
    const impersonationToken = started.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/platform-admin/tenants')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ name: 'Should not be created', ownerEmail: `nope_${t}@example.com`, planCode: 'FREE' })
      .expect(403);

    // Cannot start a second impersonation session from an impersonation token.
    await request(app.getHttpServer())
      .post('/platform-admin/impersonation')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ tenantId: owner.tenantId, targetUserId: owner.userId, reason: 'test: nested impersonation' })
      .expect(403);

    // Cannot suspend or assign a plan either.
    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${owner.tenantId}/suspend`)
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ reason: 'test: should be refused' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/platform-admin/tenants/${owner.tenantId}/plan`)
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ planCode: 'PRO', reason: 'test: should be refused' })
      .expect(403);
  });
});
