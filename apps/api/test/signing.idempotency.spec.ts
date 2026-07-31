import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `idem_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Idem Tenant ${suffix}` })
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
      clientId: `idem-client-${suffix}`,
      clientSecret: `idem-secret-${suffix}`,
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

describe('Signing idempotency (T035)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Signing idempotency');
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

  it('duplicate submit for same documentVersion does not duplicate signatures', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));

    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'INVOICE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `IDEM-${Date.now()}`,
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
        receiver: { type: 'B', id: '987654321', name: 'Buyer' },
        lines: [
          {
            description: 'Item',
            itemType: 'EGS',
            itemCode: 'EGS-1',
            unitType: 'EA',
            quantity: '1',
            unitPrice: '10.00',
            taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/mark-ready`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);

    const code = await request(app.getHttpServer())
      .post('/devices/pairing-codes')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({})
      .expect(201);

    const paired = await request(app.getHttpServer())
      .post('/agent/pair')
      .send({ pairingCode: code.body.code, label: 'Idem PC' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/send-for-signature`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(202);

    const claimed = await request(app.getHttpServer())
      .post('/agent/jobs/claim')
      .set('Authorization', `Bearer ${paired.body.deviceToken}`)
      .send({ max: 1 })
      .expect(200);

    const job = claimed.body.jobs[0];
    const submitBody = {
      documentId: created.body.id,
      documentVersion: job.documentVersion,
      signatureType: 'I',
      cadesBase64: Buffer.from('idempotent-cades').toString('base64'),
    };

    await request(app.getHttpServer())
      .post(`/agent/jobs/${job.jobId}/submit`)
      .set('Authorization', `Bearer ${paired.body.deviceToken}`)
      .send(submitBody)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/agent/jobs/${job.jobId}/submit`)
      .set('Authorization', `Bearer ${paired.body.deviceToken}`)
      .send(submitBody)
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const signatures = detail.body.signaturesJson ?? detail.body.signatures ?? [];
    const arr = Array.isArray(signatures) ? signatures : [];
    expect(arr.length).toBe(1);
    expect(arr[0].signatureType ?? arr[0].type).toBe('I');
  });
});
