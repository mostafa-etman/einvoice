import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `sync_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Sync ${suffix}` })
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

describe('Sync Idempotency-Key header (T013)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Sync idempotency header');
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

  it('rejects draft sync without Idempotency-Key', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `hdr-${Date.now()}`);
    await request(app.getHttpServer())
      .put('/sync/drafts')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `INV-${Date.now()}`))
      .expect(400);
  });
});
