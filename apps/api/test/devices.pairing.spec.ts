import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `dev_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'Devices Owner' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Devices Tenant ${suffix}` })
    .expect(201);
  const tenantId = tenant.body.id as string;

  // The Free plan only allows 1 paired device — override so this suite can
  // exercise repeated/attempted pairing without tripping the quota gate (013-saas-layer).
  const tenantPrisma = app.get(TenantPrismaService);
  await tenantPrisma.withTenant(tenantId, (tx) =>
    tx.quotaOverride.create({
      data: {
        tenantId,
        deviceQuota: 10,
        reason: 'test: allow multiple device pairings in the devices pairing suite',
        createdByUserId: reg.body.user.id as string,
      },
    }),
  );

  return {
    email,
    token: reg.body.accessToken as string,
    tenantId,
  };
}

describe('Devices pairing API', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Devices pairing API');
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

  it('creates a pairing code, pairs, heartbeats, then unpair -> 401 on next call', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));

    const created = await request(app.getHttpServer())
      .post('/devices/pairing-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(201);
    expect(typeof created.body.code).toBe('string');
    expect(created.body.code.length).toBeGreaterThan(10);
    expect(created.body.expiresAt).toBeTruthy();

    const listedCodes = await request(app.getHttpServer())
      .get('/devices/pairing-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(listedCodes.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(
      true,
    );
    // Plaintext code is never re-exposed via list.
    expect(JSON.stringify(listedCodes.body)).not.toContain(created.body.code.split('.')[1]);

    const paired = await request(app.getHttpServer())
      .post('/agent/pair')
      .send({
        pairingCode: created.body.code,
        label: 'Test Workstation',
        machineFingerprint: 'fp-123',
      })
      .expect(201);
    expect(paired.body.deviceId).toBeTruthy();
    expect(typeof paired.body.deviceToken).toBe('string');
    const deviceToken = paired.body.deviceToken as string;

    // Reusing the same pairing code fails (single-use).
    await request(app.getHttpServer())
      .post('/agent/pair')
      .send({ pairingCode: created.body.code, label: 'Second Workstation' })
      .expect(400);

    const devices = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const device = devices.body.items.find((d: { id: string }) => d.id === paired.body.deviceId);
    expect(device).toBeTruthy();
    expect(device.status).toBe('PAIRED');
    expect(JSON.stringify(devices.body)).not.toContain(deviceToken);

    const heartbeat = await request(app.getHttpServer())
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ ready: { tokenPresent: true, pendingLocal: 0 } })
      .expect(200);
    expect(heartbeat.body.ok).toBe(true);

    const devicesAfterHeartbeat = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const seen = devicesAfterHeartbeat.body.items.find(
      (d: { id: string }) => d.id === paired.body.deviceId,
    );
    expect(seen.lastSeenAt).toBeTruthy();

    // No auth header on agent calls -> 401.
    await request(app.getHttpServer()).post('/agent/heartbeat').send({}).expect(401);

    await request(app.getHttpServer())
      .post(`/devices/${paired.body.deviceId}/unpair`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(204);

    // Revoked device token must be rejected immediately.
    await request(app.getHttpServer())
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({})
      .expect(401);

    const devicesAfterUnpair = await request(app.getHttpServer())
      .get('/devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const revoked = devicesAfterUnpair.body.items.find(
      (d: { id: string }) => d.id === paired.body.deviceId,
    );
    expect(revoked.status).toBe('REVOKED');
  });

  it('rejects expired/revoked pairing codes', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `exp${Date.now()}`);

    const created = await request(app.getHttpServer())
      .post('/devices/pairing-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/devices/pairing-codes/${created.body.id}/revoke`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(204);

    await request(app.getHttpServer())
      .post('/agent/pair')
      .send({ pairingCode: created.body.code, label: 'Revoked Workstation' })
      .expect(400);
  });

  it('a viewer without devices.manage cannot create pairing codes', async () => {
    if (!dbAvailable) return;
    const suffix = `viewer${Date.now()}`;
    const owner = await ownerCtx(app, suffix);
    const invite = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `dev_viewer_${suffix}@example.com`, password: 'Password123!' })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'Viewer');

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ email: `dev_viewer_${suffix}@example.com`, roleId: viewerRole.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/devices/pairing-codes')
      .set('Authorization', `Bearer ${invite.body.accessToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({})
      .expect(403);
  });
});

describe('Devices pairing gate', () => {
  it('records whether the DB-backed suite above ran', async () => {
    const available = await isDatabaseAvailable();
    expect(typeof available).toBe('boolean');
  });
});
