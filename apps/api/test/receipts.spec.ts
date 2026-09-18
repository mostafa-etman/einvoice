import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `rcpt_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Receipt ${suffix}` })
    .expect(201);
  const tenantId = tenant.body.id as string;
  const userId = reg.body.user.id as string;
  const tenantPrisma = app.get(TenantPrismaService);
  await tenantPrisma.withTenant(tenantId, (tx) =>
    tx.quotaOverride.create({
      data: {
        tenantId,
        deviceQuota: 10,
        branchQuota: 10,
        reason: 'test: receipts builder',
        createdByUserId: userId,
      },
    }),
  );
  const branches = await request(app.getHttpServer())
    .get('/branches')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .set('X-Tenant-Id', tenantId)
    .expect(200);
  return {
    token: reg.body.accessToken as string,
    tenantId,
    branchId: branches.body[0].id as string,
    userId,
  };
}

async function seedReadyReceipt(
  app: INestApplication,
  ctx: Awaited<ReturnType<typeof ownerCtx>>,
  opts?: { skipCreate?: boolean },
) {
  await request(app.getHttpServer())
    .put('/settings/eta-credentials')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      registrationNumber: '200000000000003',
      taxpayerLegalName: 'Receipt Taxpayer LLC',
      activityCode: '6201',
      syndicateLicenseNumber: 'C',
      defaultReceiptType: 's',
    })
    .expect(200);

  await request(app.getHttpServer())
    .patch(`/branches/${ctx.branchId}`)
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send({
      receiptsEnabled: true,
      etaBranchCode: '0',
      activityCode: '6201',
      address: {
        country: 'EG',
        governate: 'Cairo',
        regionCity: 'Cairo',
        street: 'Street',
        buildingNumber: '1',
      },
    })
    .expect(200);

  const pos = await request(app.getHttpServer())
    .post('/pos-devices')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send({
      branchId: ctx.branchId,
      label: 'Till 1',
      serialNumber: `POS-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      osVersion: 'Windows 10',
      modelFramework: '1',
      preSharedKey: 'psk-receipt-test',
    })
    .expect(201);

  const draft = {
    branchId: ctx.branchId,
    posDeviceId: pos.body.id as string,
    receiptType: 's',
    dateTimeIssued: '2026-02-13T14:00:00Z',
    paymentMethod: 'C',
    buyer: { type: 'P' as const },
    lines: [
      {
        internalCode: 'SKU-1',
        description: 'Service',
        itemType: 'EGS',
        itemCode: 'EG-123456789-123456',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }],
      },
    ],
  };

  if (opts?.skipCreate) {
    return { ...draft, id: '', uuid: '', posDeviceId: pos.body.id as string, draft };
  }

  const created = await request(app.getHttpServer())
    .post('/receipts')
    .set('Authorization', `Bearer ${ctx.token}`)
    .set('X-Tenant-Id', ctx.tenantId)
    .send(draft)
    .expect(201);

  return {
    id: created.body.id as string,
    uuid: created.body.uuid as string,
    posDeviceId: pos.body.id as string,
    draft,
  };
}

describe('Receipts document builder API', () => {
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

  it('previews without advancing previousUUID, then persists and chains per POS', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        registrationNumber: '200000000000003',
        taxpayerLegalName: 'Receipt Taxpayer LLC',
        activityCode: '6201',
        syndicateLicenseNumber: 'C',
        defaultReceiptType: 's',
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/branches/${ctx.branchId}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        receiptsEnabled: true,
        etaBranchCode: '0',
        activityCode: '6201',
        address: {
          country: 'EG',
          governate: 'Cairo',
          regionCity: 'Cairo',
          street: 'Street',
          buildingNumber: '1',
        },
      })
      .expect(200);

    const pos = await request(app.getHttpServer())
      .post('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        branchId: ctx.branchId,
        label: 'Till 1',
        serialNumber: `POS-${Date.now()}`,
        osVersion: 'Windows 10',
        modelFramework: '1',
        preSharedKey: 'psk-receipt-test',
      })
      .expect(201);

    const draft = {
      branchId: ctx.branchId,
      posDeviceId: pos.body.id,
      receiptType: 's',
      dateTimeIssued: '2026-02-13T14:00:00Z',
      paymentMethod: 'C',
      buyer: { type: 'P' },
      lines: [
        {
          internalCode: 'SKU-1',
          description: 'Service',
          itemType: 'EGS',
          itemCode: 'EG-123456789-123456',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }],
        },
      ],
    };

    const preview1 = await request(app.getHttpServer())
      .post('/receipts/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draft)
      .expect(200);

    expect(preview1.body.previousUUID).toBe('');
    expect(preview1.body.uuid).toMatch(/^[0-9a-f]{64}$/);
    expect(preview1.body.etaPayload.feesAmount).toBe(0);
    expect(preview1.body.etaPayload.itemData[0].unitPrice).toBe(100);
    expect(preview1.body.issues).toEqual([]);

    const stillEmpty = await request(app.getHttpServer())
      .get('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(stillEmpty.body[0].lastReceiptUuid).toBe('');

    const created = await request(app.getHttpServer())
      .post('/receipts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draft)
      .expect(201);

    expect(created.body.uuid).toBe(preview1.body.uuid);
    expect(created.body.previousUuid).toBe('');

    const afterFirst = await request(app.getHttpServer())
      .get('/pos-devices')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(afterFirst.body[0].lastReceiptUuid).toBe(created.body.uuid);

    const second = await request(app.getHttpServer())
      .post('/receipts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draft)
      .expect(201);

    expect(second.body.previousUuid).toBe(created.body.uuid);
    expect(second.body.uuid).not.toBe(created.body.uuid);
  });

  it('creates a return receipt with referenceUUID and continues the POS chain', async () => {
    const ctx = await ownerCtx(app, `ret_${Date.now()}`);
    const sale = await seedReadyReceipt(app, ctx);

    const returned = await request(app.getHttpServer())
      .post(`/receipts/${sale.id}/return`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);

    expect(returned.body.receiptType).toBe('r');
    expect(returned.body.referenceUuid).toBe(sale.uuid);
    expect(returned.body.previousUuid).toBe(sale.uuid);
    expect(returned.body.form.buyer.type).toBe('P');
    expect(returned.body.form.lines).toHaveLength(1);
    expect(returned.body.canReturn).toBe(false);
  });

  it('uses one previousUUID chain across branches when POS serial scope is COMPANY', async () => {
    const ctx = await ownerCtx(app, `co_${Date.now()}`);
    const seeded = await seedReadyReceipt(app, ctx, { skipCreate: true });

    const other = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        name: 'Second',
        receiptsEnabled: true,
        etaBranchCode: '1',
        activityCode: '6201',
        address: {
          country: 'EG',
          governate: 'Giza',
          regionCity: 'Giza',
          street: 'Nile',
          buildingNumber: '2',
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .put('/settings/company')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        posSerialScope: 'COMPANY',
        sharedPosDeviceId: seeded.posDeviceId,
      })
      .expect(200);

    const draft = {
      ...seeded.draft,
      branchId: other.body.id,
      posDeviceId: seeded.posDeviceId,
    };

    const first = await request(app.getHttpServer())
      .post('/receipts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draft)
      .expect(201);

    expect(first.body.branchId).toBe(other.body.id);
    expect(first.body.posDeviceId).toBe(seeded.posDeviceId);
    expect(first.body.previousUuid).toBe('');

    const second = await request(app.getHttpServer())
      .post('/receipts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ ...seeded.draft, branchId: ctx.branchId })
      .expect(201);

    expect(second.body.previousUuid).toBe(first.body.uuid);
    expect(second.body.posDeviceId).toBe(seeded.posDeviceId);
  });

  it('exposes submit route and ETA status fields without requiring the invoice agent', async () => {
    const ctx = await ownerCtx(app, `sub_${Date.now()}`);
    const seeded = await seedReadyReceipt(app, ctx);
    const got = await request(app.getHttpServer())
      .get(`/receipts/${seeded.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(got.body).toHaveProperty('etaStatus');
    expect(got.body).toHaveProperty('submissionUuid');
    expect(got.body.status).toBe('DRAFT');
  });
});
