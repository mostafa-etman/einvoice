import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

const COMPLETE_ADDRESS = {
  country: 'EG',
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Abbas El Akkad',
  buildingNumber: '12',
};

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `cn_recv_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `CN recv ${suffix}` })
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

function line() {
  return {
    description: 'Service',
    itemType: 'EGS',
    itemCode: 'EGS-1',
    unitType: 'EA',
    quantity: '1',
    unitPrice: '10.00',
    discountAmount: '0.00',
    taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
  };
}

describe('Credit note ETA receiver payload', () => {
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

  it('manual credit note omits null branch and never sends an invalid type', async () => {
    const ctx = await ownerCtx(app, `m${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'CREDIT_NOTE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `CN-MAN-${Date.now()}`,
        version: 0,
        taxpayerActivityCode: '4620',
        receiver: {
          type: 'C',
          id: '111111111',
          name: 'Buyer Co',
          branch: null,
          address: { ...COMPLETE_ADDRESS, branchID: null },
        },
        references: ['TZRKK8MFZCPSTW9XCYWBMKME11'],
        lines: [line()],
      })
      .expect(201);

    const recv = created.body.etaPayload?.receiver as Record<string, unknown>;
    expect(recv.type).toBe('B');
    expect(recv.id).toBe('111111111');
    expect(recv.name).toBe('Buyer Co');
    expect(recv).not.toHaveProperty('branch');
    expect(recv.address).toEqual(COMPLETE_ADDRESS);
  });

  it('return copies the original invoice receiver and drops null branch', async () => {
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
        internalId: `INV-RET-${Date.now()}`,
        version: 0,
        taxpayerActivityCode: '4620',
        receiver: {
          type: 'B',
          id: '987654321',
          name: 'Original Buyer',
          address: COMPLETE_ADDRESS,
        },
        lines: [line()],
      })
      .expect(201);

    const dirtyPayload = {
      ...(created.body.etaPayload as Record<string, unknown>),
      receiver: {
        Type: 'B',
        id: '987654321',
        name: 'Original Buyer',
        address: { ...COMPLETE_ADDRESS, branchID: null, branch: null },
        branch: null,
      },
    };

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.update({
        where: { id: created.body.id },
        data: {
          status: 'VALID',
          etaUuid: 'TZRKK8MFZCPSTW9XCYWBMKME11',
          receiverType: '',
          etaPayloadJson: dirtyPayload,
        },
      }),
    );

    const returned = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/return`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);

    expect(returned.body.kind).toBe('CREDIT_NOTE');
    const recv = returned.body.etaPayload?.receiver as Record<string, unknown>;
    expect(recv.type).toBe('B');
    expect(recv.id).toBe('987654321');
    expect(recv.name).toBe('Original Buyer');
    expect(recv).not.toHaveProperty('branch');
    expect(recv.address).toEqual(COMPLETE_ADDRESS);
    expect(returned.body.etaPayload.references).toEqual([
      'TZRKK8MFZCPSTW9XCYWBMKME11',
    ]);
  });

  it('return keeps a non-empty receiver.branch from the original invoice', async () => {
    const ctx = await ownerCtx(app, `b${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        kind: 'INVOICE',
        branchId: ctx.branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date().toISOString(),
        internalId: `INV-BR-${Date.now()}`,
        version: 0,
        taxpayerActivityCode: '4620',
        receiver: {
          type: 'B',
          id: '123456789',
          name: 'Branchy Buyer',
          address: COMPLETE_ADDRESS,
        },
        lines: [line()],
      })
      .expect(201);

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.update({
        where: { id: created.body.id },
        data: {
          status: 'VALID',
          etaUuid: 'AAAAAAAAAAAAAABBBBBBBBBBBB11',
          etaPayloadJson: {
            ...(created.body.etaPayload as Record<string, unknown>),
            receiver: {
              type: 'B',
              id: '123456789',
              name: 'Branchy Buyer',
              address: COMPLETE_ADDRESS,
              branch: '0',
            },
          },
        },
      }),
    );

    const returned = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/return`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);

    const recv = returned.body.etaPayload?.receiver as Record<string, unknown>;
    expect(recv.type).toBe('B');
    expect(recv.branch).toBe('0');
  });
});
