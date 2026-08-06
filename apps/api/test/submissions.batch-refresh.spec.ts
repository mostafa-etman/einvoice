import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `batch_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Batch ${suffix}` })
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
    .post('/item-codes')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ type: 'EGS', code: 'EGS-BATCH', description: 'Batch item' })
    .expect(201);

  return {
    token,
    tenantId,
    branchId: branches.body[0].id as string,
  };
}

describe('Batch submit + status refresh API', () => {
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

  it('POST /submissions skips non-SIGNED docs with per-document results', async () => {
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
        internalId: `BATCH-${Date.now()}`,
        version: 0,
        receiver: { type: 'B', name: 'Buyer' },
        lines: [
          {
            description: 'Service',
            itemType: 'EGS',
            itemCode: 'EGS-BATCH',
            unitType: 'EA',
            quantity: '1',
            unitPrice: '10.00',
            taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
          },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/submissions')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .set('Idempotency-Key', `test-batch-${Date.now()}`)
      .send({ documentIds: [created.body.id] })
      .expect(202);

    expect(res.body.requested).toBe(1);
    expect(res.body.sent).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.results[0]).toMatchObject({
      documentId: created.body.id,
      outcome: 'skipped',
      reason: 'status_draft',
      documentStatus: 'DRAFT',
    });
  });

  it('POST /documents/refresh-status skips docs without etaUuid', async () => {
    const ctx = await ownerCtx(app, `r${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'INVOICE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `REF-${Date.now()}`,
        version: 0,
        receiver: { type: 'B', name: 'Buyer' },
        lines: [
          {
            description: 'Service',
            itemType: 'EGS',
            itemCode: 'EGS-BATCH',
            unitType: 'EA',
            quantity: '1',
            unitPrice: '10.00',
            taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
          },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/documents/refresh-status')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ documentIds: [created.body.id] })
      .expect(200);

    expect(res.body.requested).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.results[0]).toMatchObject({
      outcome: 'skipped',
      reason: 'no_eta_uuid',
    });
  });

  it('list includes etaStatusUpdatedAt for last-checked display', async () => {
    const ctx = await ownerCtx(app, `l${Date.now()}`);
    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'INVOICE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `LIST-${Date.now()}`,
        version: 0,
        receiver: { type: 'B', name: 'Buyer' },
        lines: [
          {
            description: 'Service',
            itemType: 'EGS',
            itemCode: 'EGS-BATCH',
            unitType: 'EA',
            quantity: '1',
            unitPrice: '10.00',
            taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
          },
        ],
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(list.body.items[0]).toEqual(
      expect.objectContaining({
        etaStatus: null,
        etaUuid: null,
      }),
    );
    expect(list.body.items[0]).toHaveProperty('etaStatusUpdatedAt');
  });
});
