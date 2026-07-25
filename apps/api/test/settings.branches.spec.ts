import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `br_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Branches ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Settings branches API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and updates branches with single default', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));

    const created = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        name: 'Secondary',
        isDefault: true,
        etaBranchCode: '0',
        activityCode: '6201',
      })
      .expect(201);

    expect(created.body.isDefault).toBe(true);
    expect(created.body.isActive).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const defaults = list.body.filter((b: { isDefault: boolean }) => b.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(created.body.id);

    await request(app.getHttpServer())
      .patch(`/branches/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ activityCode: '6202' })
      .expect(200);
  });
});
