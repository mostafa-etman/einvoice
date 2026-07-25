import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `item_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Items ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Settings item codes API', () => {
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

  it('CRUD item codes and rejects invalid type', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));

    const created = await request(app.getHttpServer())
      .post('/item-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ type: 'EGS', code: 'EG-100', description: 'Widget' })
      .expect(201);
    expect(created.body.type).toBe('EGS');

    await request(app.getHttpServer())
      .post('/item-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ type: 'OTHER', code: 'X', description: 'nope' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/item-codes/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ isActive: false })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/item-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(list.body.some((i: { code: string }) => i.code === 'EG-100')).toBe(
      true,
    );
  });
});
