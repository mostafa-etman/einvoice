import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `cust_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Customers ${suffix}` })
    .expect(201);
  const token =
    (tenant.body.accessToken as string | undefined) ??
    (reg.body.accessToken as string);
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
    .send({ type: 'EGS', code: 'EGS-CUST-1', description: 'Test item' })
    .expect(201);

  return {
    token,
    tenantId,
    branchId: branches.body[0].id as string,
  };
}

describe('Customers directory + ETA receiver payload', () => {
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

  it('customer autofill receiver matches manual receiver in ETA payload', async () => {
    const suffix = String(Date.now());
    const ctx = await ownerCtx(app, suffix);

    const address = {
      country: 'EG',
      governate: 'Cairo',
      regionCity: 'Nasr City',
      street: 'Abbas El Akkad',
      buildingNumber: '12',
      postalCode: '11765',
    };

    const customer = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        type: 'B',
        registrationId: '987654321',
        name: 'عميل الاختبار',
        nameEn: 'Test Customer Co',
        address,
        code: 'C-1',
      })
      .expect(201);

    expect(customer.body.receiver).toEqual({
      type: 'B',
      id: '987654321',
      name: 'عميل الاختبار',
      address: expect.objectContaining(address),
    });

    const search = await request(app.getHttpServer())
      .get('/customers/search')
      .query({ q: '987654321' })
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(search.body.items.some((i: { id: string }) => i.id === customer.body.id)).toBe(
      true,
    );

    const draftBody = (receiver: {
      type: string;
      id: string;
      name: string;
      address: Record<string, string>;
    }, internalId: string) => ({
      kind: 'INVOICE',
      branchId: ctx.branchId,
      currencyCode: 'EGP',
      issueDateTime: new Date().toISOString(),
      internalId,
      version: 0,
      receiver,
      lines: [
        {
          description: 'Service',
          itemType: 'EGS',
          itemCode: 'EGS-CUST-1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
          discountAmount: '0.00',
          taxes: [{ taxType: 'T1', subType: 'V001', rate: '14.00' }],
        },
      ],
    });

    const fromCustomer = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(customer.body.receiver, `CUST-${suffix}`))
      .expect(201);

    const manual = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(
        draftBody(
          {
            type: 'B',
            id: '987654321',
            name: 'عميل الاختبار',
            address,
          },
          `MAN-${suffix}`,
        ),
      )
      .expect(201);

    const recvFromCustomer = fromCustomer.body.etaPayload?.receiver;
    const recvManual = manual.body.etaPayload?.receiver;
    expect(recvFromCustomer).toBeTruthy();
    expect(recvManual).toBeTruthy();
    expect(recvFromCustomer.type).toBe(recvManual.type);
    expect(recvFromCustomer.id).toBe(recvManual.id);
    expect(recvFromCustomer.name).toBe(recvManual.name);
    expect(recvFromCustomer.address).toMatchObject(recvManual.address);

    await request(app.getHttpServer())
      .post(`/customers/${customer.body.id}/deactivate`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get(`/customers/${customer.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(after.body.isActive).toBe(false);
  });
});
