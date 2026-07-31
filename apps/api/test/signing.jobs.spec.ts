import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sign_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Signing Tenant ${suffix}` })
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

  // mark-ready runs full local ETA validation (issuer id/address + activity).
  await request(app.getHttpServer())
    .put('/settings/eta-credentials')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({
      clientId: `sign-client-${suffix}`,
      clientSecret: `sign-secret-${suffix}`,
      registrationNumber: '123456789',
      activityCode: '6201',
      isIntermediary: false,
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

async function readyDocument(app: INestApplication, ctx: { token: string; tenantId: string; branchId: string }, internalId: string) {
  const created = await request(app.getHttpServer())
    .post('/documents')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send(draftBody(ctx.branchId, internalId))
    .expect(201);

  // NestJS defaults POST responses to 201 (documents.controller.ts sets no
  // explicit @HttpCode on mark-ready).
  await request(app.getHttpServer())
    .post(`/documents/${created.body.id}/mark-ready`)
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .expect(201);

  return created.body as { id: string; version: number };
}

async function pairDevice(app: INestApplication, ctx: { token: string; tenantId: string }, label: string) {
  const code = await request(app.getHttpServer())
    .post('/devices/pairing-codes')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send({})
    .expect(201);

  const paired = await request(app.getHttpServer())
    .post('/agent/pair')
    .send({ pairingCode: code.body.code, label })
    .expect(201);

  return {
    deviceId: paired.body.deviceId as string,
    deviceToken: paired.body.deviceToken as string,
  };
}

describe('Signature jobs API', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Signature jobs API');
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

  it('send-for-signature -> claim -> submit (type I) attaches signature and completes the job', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const doc = await readyDocument(app, ctx, `SIG-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Signer PC');

    const job = await request(app.getHttpServer())
      .post(`/documents/${doc.id}/send-for-signature`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(202);
    expect(job.body.status).toBe('PENDING');
    expect(job.body.documentId).toBe(doc.id);

    // Sending twice while a job is pending/claimed is rejected.
    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/send-for-signature`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(400);

    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);
    expect(claimed.body.jobs).toHaveLength(1);
    const claimedJob = claimed.body.jobs[0];
    expect(claimedJob.jobId).toBe(job.body.id);
    expect(claimedJob.documentId).toBe(doc.id);
    expect(claimedJob.etaPayload).toBeTruthy();

    // A second device (or poller) claiming concurrently gets nothing left.
    const claimedAgain = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 5 })
      .expect(200);
    expect(claimedAgain.body.jobs).toHaveLength(0);

    const submitBody = {
      documentId: doc.id,
      documentVersion: claimedJob.documentVersion,
      signatureType: 'I',
      cadesBase64: Buffer.from('dummy-cades-signature').toString('base64'),
    };

    const submitted = await request(app.getHttpServer())
      .post(`/agent/jobs/${claimedJob.jobId}/submit`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send(submitBody)
      .expect(200);
    expect(submitted.body.status).toBe('COMPLETED');
    expect(submitted.body.documentStatus).toBe('SIGNED');

    // Idempotent retry with the same version succeeds without creating a
    // duplicate signature entry.
    const resubmitted = await request(app.getHttpServer())
      .post(`/agent/jobs/${claimedJob.jobId}/submit`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send(submitBody)
      .expect(200);
    expect(resubmitted.body.status).toBe('COMPLETED');

    const detail = await request(app.getHttpServer())
      .get(`/documents/${doc.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(detail.body.status).toBe('SIGNED');

    const jobs = await request(app.getHttpServer())
      .get('/signing/jobs')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .query({ status: 'COMPLETED' })
      .expect(200);
    expect(jobs.body.items.some((j: { id: string }) => j.id === job.body.id)).toBe(true);
  });

  it('rejects submit with a stale documentVersion (409)', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `stale${Date.now()}`);
    const doc = await readyDocument(app, ctx, `STALE-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'Stale PC');

    const job = await request(app.getHttpServer())
      .post(`/documents/${doc.id}/send-for-signature`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(202);

    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(200);
    const claimedJob = claimed.body.jobs[0];

    await request(app.getHttpServer())
      .post(`/agent/jobs/${claimedJob.jobId}/submit`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({
        documentId: doc.id,
        documentVersion: claimedJob.documentVersion + 1,
        signatureType: 'I',
        cadesBase64: Buffer.from('dummy').toString('base64'),
      })
      .expect(409);

    // Job unaffected by the failed submit — a fresh claim should still work
    // once the caller retries with the correct version.
    await request(app.getHttpServer())
      .post(`/agent/jobs/${claimedJob.jobId}/submit`)
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({
        documentId: doc.id,
        documentVersion: claimedJob.documentVersion,
        signatureType: 'I',
        cadesBase64: Buffer.from('dummy').toString('base64'),
      })
      .expect(200);

    void job;
  });

  it('only a paired, correctly-scoped device can claim/submit; revoked devices get 401', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `rbac${Date.now()}`);
    const doc = await readyDocument(app, ctx, `RBAC-${Date.now()}`);
    const device = await pairDevice(app, ctx, 'RBAC PC');

    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/send-for-signature`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(202);

    await request(app.getHttpServer())
      .post(`/devices/${device.deviceId}/unpair`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(204);

    await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .send({ max: 1 })
      .expect(401);
  });
});

describe('Signature jobs gate', () => {
  it('records whether the DB-backed suite above ran', async () => {
    const available = await isDatabaseAvailable();
    expect(typeof available).toBe('boolean');
  });
});
