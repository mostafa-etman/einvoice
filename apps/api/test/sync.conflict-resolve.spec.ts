import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

/**
 * T038 — resolve KEEP_LOCAL / KEEP_SERVER / MERGED.
 * KEEP_SERVER covered in sync.conflict.spec; this file exercises KEEP_LOCAL.
 */
async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `res_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Res ${suffix}` })
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
    .send({ type: 'EGS', code: 'EGS-1', description: 'Test item' })
    .expect(201);

  return { token, tenantId, branchId: branches.body[0].id as string };
}

function draftBody(branchId: string, internalId: string, receiverName: string) {
  return {
    kind: 'INVOICE',
    branchId,
    currencyCode: 'EGP',
    issueDateTime: new Date().toISOString(),
    internalId,
    version: 0,
    receiver: { type: 'B', name: receiverName },
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

describe('Sync conflict resolve (T038)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Sync conflict resolve');
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

  it('KEEP_LOCAL applies local snapshot after 409', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const key = `resolve-key-${Date.now()}`;
    const internalId = `INV-RES-${Date.now()}`;

    const created = await request(app.getHttpServer())
      .put('/sync/drafts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .set('Idempotency-Key', key)
      .send(draftBody(ctx.branchId, internalId, 'Local Buyer'))
      .expect(201);

    await request(app.getHttpServer())
      .put('/sync/drafts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .set('Idempotency-Key', key)
      .set('If-Match-Revision', String(created.body.syncRevision))
      .send(draftBody(ctx.branchId, internalId, 'Server Buyer'))
      .expect(200);

    const clash = await request(app.getHttpServer())
      .put('/sync/drafts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .set('Idempotency-Key', key)
      .set('If-Match-Revision', String(created.body.syncRevision))
      .send(draftBody(ctx.branchId, internalId, 'Keep Me Local'))
      .expect(409);

    const conflictId =
      clash.body.conflictId ??
      (clash.body as { message?: { conflictId?: string } }).message?.conflictId;

    const resolved = await request(app.getHttpServer())
      .post(`/sync/conflicts/${conflictId}/resolve`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        resolution: 'KEEP_LOCAL',
        mergedPayload: draftBody(ctx.branchId, internalId, 'Keep Me Local'),
      })
      .expect(200);

    expect(resolved.body.id).toBe(created.body.id);

    const got = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(got.body.etaPayload?.receiver?.name).toBe('Keep Me Local');
  });
});
