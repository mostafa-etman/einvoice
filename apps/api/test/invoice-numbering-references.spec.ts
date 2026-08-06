import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const COMPLETE_ADDRESS = {
  country: 'EG',
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Abbas El Akkad',
  buildingNumber: '12',
};

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `num_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Numbering ${suffix}` })
    .expect(201);
  const tenantId = tenant.body.id as string;

  await request(app.getHttpServer())
    .post('/currencies')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ currencyCode: 'EGP', isDefault: true })
    .expect(201);

  await request(app.getHttpServer())
    .post('/item-codes')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ type: 'EGS', code: 'EGS-1', description: 'Test item' })
    .expect(201);

  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  const branchId = branches.body[0].id as string;

  await request(app.getHttpServer())
    .patch(`/branches/${branchId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({ address: COMPLETE_ADDRESS, activityCode: '4620' })
    .expect(200);

  await request(app.getHttpServer())
    .put('/settings/eta-credentials')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant-Id', tenantId)
    .send({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      registrationNumber: '999999999',
      activityCode: '4620',
      taxpayerLegalName: 'Numbering Co LLC',
      issuerType: 'B',
    })
    .expect(200);

  return { token, tenantId, branchId };
}

function line() {
  return {
    description: 'Service',
    itemType: 'EGS',
    itemCode: 'EGS-1',
    unitType: 'EA',
    quantity: '1',
    unitPrice: '100.00',
    discountAmount: '0.00',
    taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
  };
}

describe('invoice numbering + credit note references', () => {
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

  it('allocates unique scheme-based internalIds and rejects ETA-invalid overrides', async () => {
    const ctx = await ownerCtx(app, `${Date.now()}`);

    await request(app.getHttpServer())
      .put('/settings/invoice-numbering')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        prefix: 'INV-',
        padWidth: 6,
        startingNumber: 1,
        charset: 'NUMERIC',
        scope: 'TENANT',
      })
      .expect(200);

    const a = await request(app.getHttpServer())
      .get('/settings/invoice-numbering/next?allocate=true')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(a.body.internalId).toBe('INV-000001');

    const b = await request(app.getHttpServer())
      .get('/settings/invoice-numbering/next?allocate=true')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(b.body.internalId).toBe('INV-000002');

    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'INVOICE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: 'BAD ID',
        version: 0,
        receiver: { type: 'B', id: '1', name: 'Buyer' },
        lines: [line()],
      })
      .expect(400);
  });

  it('builds credit note ETA payload with picked and manual references', async () => {
    const ctx = await ownerCtx(app, `cn${Date.now()}`);
    const picked = 'TZRKK8MFZCPSTW9XCYWBMKME11';
    const manual = 'LEGACY-EXT-REF-0001';

    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'CREDIT_NOTE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `CN-${Date.now()}`,
        version: 0,
        taxpayerActivityCode: '4620',
        receiver: {
          type: 'B',
          id: '111111111',
          name: 'Buyer Co',
          address: COMPLETE_ADDRESS,
        },
        references: [picked, manual],
        lines: [line()],
      })
      .expect(201);

    expect(created.body.etaPayload.references).toEqual([picked, manual]);
    expect(created.body.etaPayload.documentType).toBe('C');

    await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/mark-ready`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);
  });
});
