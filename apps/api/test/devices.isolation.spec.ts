import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerTenant(app: INestApplication, name: string) {
  const email = `${name.replace(/\W/g, '_').toLowerCase()}_${Date.now()}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

describe('Devices tenant isolation (T041)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Devices isolation');
      return;
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('tenant A cannot list or unpair tenant B devices', async () => {
    if (!dbAvailable) return;
    const a = await ownerTenant(app, 'Devices Iso A');
    const b = await ownerTenant(app, 'Devices Iso B');

    const codeB = await request(app.getHttpServer())
      .post('/devices/pairing-codes')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .send({})
      .expect(201);

    const pairedB = await request(app.getHttpServer())
      .post('/agent/pair')
      .send({ pairingCode: codeB.body.code, label: 'Tenant B PC' })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(200);

    expect(listA.body.items.some((d: { id: string }) => d.id === pairedB.body.deviceId)).toBe(
      false,
    );

    await request(app.getHttpServer())
      .post(`/devices/${pairedB.body.deviceId}/unpair`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(404);

    // B can still heartbeat with its token
    await request(app.getHttpServer())
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${pairedB.body.deviceToken}`)
      .send({ ready: { tokenPresent: true, pendingLocal: 0 } })
      .expect(200);
  });
});
