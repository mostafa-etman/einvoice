import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { DOCUMENT_NOT_EDITABLE_MESSAGE } from '../src/documents/documents-mutability';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `valid_ro_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Valid RO ${suffix}` })
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

  return {
    token,
    tenantId,
    branchId: branches.body[0].id as string,
  };
}

function draftBody(branchId: string, internalId: string) {
  return {
    kind: 'INVOICE',
    branchId,
    currencyCode: 'EGP',
    issueDateTime: new Date().toISOString(),
    internalId,
    version: 0,
    receiver: { type: 'B', name: 'Buyer Co' },
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

describe('VALID documents are read-only', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    tenantPrisma = app.get(TenantPrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects PUT / mark-ready / recalc / delete / sign / submit on VALID', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `INV-RO-${Date.now()}`))
      .expect(201);

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.update({
        where: { id: created.body.id },
        data: {
          status: 'VALID',
          etaUuid: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );

    const auth = {
      Authorization: `Bearer ${ctx.token}`,
      'X-Tenant-Id': ctx.tenantId,
    };

    const put = await request(app.getHttpServer())
      .put(`/documents/${created.body.id}`)
      .set(auth)
      .send({
        ...draftBody(ctx.branchId, created.body.internalId),
        version: created.body.version,
        receiver: { type: 'B', name: 'Hacked Buyer' },
      })
      .expect(403);
    expect(put.body.code).toBe('DOCUMENT_NOT_EDITABLE');
    expect(put.body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);

    const recalc = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/recalculate-totals`)
      .set(auth)
      .expect(403);
    expect(recalc.body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);

    const ready = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/mark-ready`)
      .set(auth)
      .expect(403);
    expect(ready.body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);

    const sign = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/send-for-signature`)
      .set(auth)
      .expect(403);
    expect(sign.body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);

    const submit = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/submit`)
      .set(auth)
      .expect(403);
    expect(submit.body.message).toBe(DOCUMENT_NOT_EDITABLE_MESSAGE);

    await request(app.getHttpServer())
      .delete(`/documents/${created.body.id}`)
      .set(auth)
      .expect(403);

    const got = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set(auth)
      .expect(200);
    expect(got.body.status).toBe('VALID');
    expect(got.body.etaPayload?.receiver?.name).toBe('Buyer Co');
    expect(got.body.version).toBe(created.body.version);

    const returned = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/return`)
      .set(auth)
      .expect(201);
    expect(returned.body.status).toBe('DRAFT');
    expect(returned.body.kind).toBe('CREDIT_NOTE');
    expect(returned.body.id).not.toBe(created.body.id);
  });

  it('still allows editing a DRAFT', async () => {
    const ctx = await ownerCtx(app, `d${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `INV-ED-${Date.now()}`))
      .expect(201);

    const updated = await request(app.getHttpServer())
      .put(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        ...draftBody(ctx.branchId, created.body.internalId),
        version: created.body.version,
        receiver: { type: 'B', name: 'Updated Buyer' },
      })
      .expect(200);
    expect(updated.body.etaPayload?.receiver?.name).toBe('Updated Buyer');
    expect(updated.body.status).toBe('DRAFT');
  });
});
