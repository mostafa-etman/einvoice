import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PENDING_STALE_MS } from '../src/signing/signing.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sigrec_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Signing Recovery ${suffix}` })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenantId = tenant.body.id as string;

  await request(app.getHttpServer())
    .post('/currencies')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ currencyCode: 'EGP', isDefault: true })
    .expect(201);

  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);

  await request(app.getHttpServer())
    .put('/settings/eta-credentials')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({
      clientId: `sigrec-client-${suffix}`,
      clientSecret: `sigrec-secret-${suffix}`,
      registrationNumber: '123456789',
      activityCode: '6201',
      isIntermediary: false,
      taxpayerLegalName: 'Seller Co',
    })
    .expect(200);

  await request(app.getHttpServer())
    .patch(`/branches/${branches.body[0].id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ activityCode: '6201', etaBranchCode: '0' })
    .expect(200);

  await request(app.getHttpServer())
    .post('/item-codes')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ type: 'EGS', code: 'EGS-1', description: 'Test item' })
    .expect(201);

  return { token, tenantId, branchId: branches.body[0].id as string };
}

function draftBody(branchId: string, internalId: string) {
  return {
    kind: 'INVOICE',
    branchId,
    currencyCode: 'EGP',
    issueDateTime: new Date().toISOString(),
    internalId,
    version: 0,
    taxpayerActivityCode: '6201',
    issuer: {
      type: 'B',
      id: '123456789',
      name: 'Seller Co',
      address: {
        branchId: '0',
        country: 'EG',
        governate: 'Cairo',
        regionCity: 'Nasr City',
        street: 'Test St',
        buildingNumber: '1',
      },
    },
    receiver: { type: 'B', id: '987654321', name: 'Buyer Co' },
    lines: [
      {
        description: 'Service',
        itemType: 'EGS',
        itemCode: 'EGS-1',
        unitType: 'EA',
        quantity: '2',
        unitPrice: '10.00',
        discountAmount: '0.00',
        taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
      },
    ],
  };
}

async function readyDocument(
  app: INestApplication,
  ctx: { token: string; tenantId: string; branchId: string },
  internalId: string,
) {
  const created = await request(app.getHttpServer())
    .post('/documents')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send(draftBody(ctx.branchId, internalId))
    .expect(201);

  await request(app.getHttpServer())
    .post(`/documents/${created.body.id}/mark-ready`)
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .expect(201);

  return created.body as { id: string; version: number };
}

async function pairDevice(
  app: INestApplication,
  ctx: { token: string; tenantId: string },
  label: string,
  fingerprint?: string,
) {
  const code = await request(app.getHttpServer())
    .post('/devices/pairing-codes')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send({})
    .expect(201);

  const paired = await request(app.getHttpServer())
    .post('/agent/pair')
    .send({
      pairingCode: code.body.code,
      label,
      ...(fingerprint ? { machineFingerprint: fingerprint } : {}),
    })
    .expect(201);

  return {
    deviceId: paired.body.deviceId as string,
    deviceToken: paired.body.deviceToken as string,
  };
}

async function withTenantDb<T>(
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  } finally {
    await prisma.$disconnect();
  }
}

function send(app: INestApplication, ctx: { token: string; tenantId: string }, documentId: string) {
  return request(app.getHttpServer())
    .post(`/documents/${documentId}/send-for-signature`)
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId);
}

function listJobs(
  app: INestApplication,
  ctx: { token: string; tenantId: string },
  query: Record<string, string> = {},
) {
  return request(app.getHttpServer())
    .get('/signing/jobs')
    .query(query)
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId);
}

describe('Signature job recovery', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Signature job recovery');
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

  it('first send is PENDING; second send reuses the same job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const doc = await readyDocument(app, ctx, `REC-IDEM-${Date.now()}`);

    const first = await send(app, ctx, doc.id).expect(202);
    expect(first.body.status).toBe('PENDING');

    const second = await send(app, ctx, doc.id).expect(202);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.status).toBe('PENDING');

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    const active = jobs.body.items.filter(
      (j: { status: string }) => j.status === 'PENDING' || j.status === 'CLAIMED',
    );
    expect(active).toHaveLength(1);
  });

  it('send while CLAIMED with a valid lease returns the same job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `lease${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-LEASE-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Lease PC');

    const queued = await send(app, ctx, doc.id).expect(202);
    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);
    expect(claimed.body.jobs[0].jobId).toBe(queued.body.id);

    const again = await send(app, ctx, doc.id).expect(202);
    expect(again.body.id).toBe(queued.body.id);
    expect(again.body.status).toBe('CLAIMED');

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    expect(
      jobs.body.items.filter((j: { status: string }) => j.status === 'PENDING' || j.status === 'CLAIMED'),
    ).toHaveLength(1);
  });

  it('send while CLAIMED with an expired lease releases it back to PENDING', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `exp${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-EXP-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Expired PC');

    const queued = await send(app, ctx, doc.id).expect(202);
    await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);

    await withTenantDb(ctx.tenantId, (tx) =>
      tx.signatureJob.update({
        where: { id: queued.body.id },
        data: { claimExpiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    const recovered = await send(app, ctx, doc.id).expect(202);
    expect(recovered.body.id).toBe(queued.body.id);
    expect(recovered.body.status).toBe('PENDING');

    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);
    expect(claimed.body.jobs[0].jobId).toBe(queued.body.id);
  });

  it('stale PENDING is CANCELLED and replaced by exactly one new PENDING job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `stale${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-STALE-${Date.now()}`);

    const first = await send(app, ctx, doc.id).expect(202);
    const staleAt = new Date(Date.now() - PENDING_STALE_MS - 1_000);
    await withTenantDb(ctx.tenantId, (tx) =>
      tx.signatureJob.update({
        where: { id: first.body.id },
        data: { updatedAt: staleAt, createdAt: staleAt },
      }),
    );

    const next = await send(app, ctx, doc.id).expect(202);
    expect(next.body.id).not.toBe(first.body.id);
    expect(next.body.status).toBe('PENDING');

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    const byId = new Map(jobs.body.items.map((j: { id: string; status: string }) => [j.id, j.status]));
    expect(byId.get(first.body.id)).toBe('CANCELLED');
    expect(byId.get(next.body.id)).toBe('PENDING');
    expect(
      jobs.body.items.filter((j: { status: string }) => j.status === 'PENDING' || j.status === 'CLAIMED'),
    ).toHaveLength(1);
  });

  it('concurrent duplicate sends leave exactly one active job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `conc${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-CONC-${Date.now()}`);

    const [a, b] = await Promise.all([
      send(app, ctx, doc.id),
      send(app, ctx, doc.id),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body.id).toBe(b.body.id);

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    expect(
      jobs.body.items.filter((j: { status: string }) => j.status === 'PENDING' || j.status === 'CLAIMED'),
    ).toHaveLength(1);
  });

  it('unpair releases CLAIMED jobs to PENDING; re-pair can claim the same job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `unp${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-UNP-${Date.now()}`);
    const fingerprint = `fp-${Date.now()}`;
    const device = await pairDevice(app, ctx, 'Unpair PC', fingerprint);

    const queued = await send(app, ctx, doc.id).expect(202);
    await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/devices/${device.deviceId}/unpair`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(204);

    const afterUnpair = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    const active = afterUnpair.body.items.find((j: { id: string }) => j.id === queued.body.id);
    expect(active.status).toBe('PENDING');
    expect(active.claimedByDeviceId).toBeNull();

    await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(401);

    const repaired = await pairDevice(app, ctx, 'Unpair PC again', fingerprint);
    expect(repaired.deviceId).toBe(device.deviceId);

    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${repaired.deviceToken}`)
      .send({ max: 1 })
      .expect(200);
    expect(claimed.body.jobs).toHaveLength(1);
    expect(claimed.body.jobs[0].jobId).toBe(queued.body.id);

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    expect(
      jobs.body.items.filter((j: { status: string }) => j.status === 'PENDING' || j.status === 'CLAIMED'),
    ).toHaveLength(1);
  });

  it('unpair leaves PENDING jobs pending and does not create a duplicate', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `unpp${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-UNPP-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Pending PC');

    const queued = await send(app, ctx, doc.id).expect(202);
    await request(app.getHttpServer())
      .post(`/devices/${device.deviceId}/unpair`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(204);

    const again = await send(app, ctx, doc.id).expect(202);
    expect(again.body.id).toBe(queued.body.id);
    expect(again.body.status).toBe('PENDING');
  });

  it('signing failure marks CLAIMED as FAILED so a new send can create a job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `fail${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-FAIL-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Fail PC');

    const queued = await send(app, ctx, doc.id).expect(202);
    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/agent/jobs/${claimed.body.jobs[0].jobId}/fail`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ code: 'SIGN_FAILED', message: 'token error' })
      .expect(200);

    const jobs = await listJobs(app, ctx, { documentId: doc.id }).expect(200);
    expect(jobs.body.items.find((j: { id: string }) => j.id === queued.body.id).status).toBe(
      'FAILED',
    );

    const retry = await send(app, ctx, doc.id).expect(202);
    expect(retry.body.id).not.toBe(queued.body.id);
    expect(retry.body.status).toBe('PENDING');
  });

  it('successful signing still completes the job and signs the document', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `ok${Date.now()}`);
    const doc = await readyDocument(app, ctx, `REC-OK-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Ok PC');

    const queued = await send(app, ctx, doc.id).expect(202);
    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/agent/jobs/${claimed.body.jobs[0].jobId}/submit`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({
        documentId: doc.id,
        documentVersion: claimed.body.jobs[0].documentVersion,
        signatureType: 'I',
        cadesBase64: Buffer.from('dummy-cades-signature').toString('base64'),
      })
      .expect(200);
    expect(submitted.body.status).toBe('COMPLETED');
    expect(submitted.body.documentStatus).toBe('SIGNED');

    const detail = await request(app.getHttpServer())
      .get(`/documents/${doc.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(detail.body.status).toBe('SIGNED');
    expect(queued.body.id).toBe(claimed.body.jobs[0].jobId);
  });
});
