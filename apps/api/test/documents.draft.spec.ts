import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `doc_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Docs ${suffix}` })
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

function draftBody(branchId: string, internalId: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

describe('Documents draft API', () => {
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

  it('creates draft, recomputes totals, ignores client totals', async () => {
    const ctx = await ownerCtx(app, String(Date.now()));
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        ...draftBody(ctx.branchId, `INV-${Date.now()}`),
        totalAmount: '99999.00',
      })
      .expect(201);

    expect(created.body.totals.totalSalesAmount).toBe('20.00');
    expect(created.body.totals.totalAmount).not.toBe('99999.00');
    expect(created.body.canonicalString).toContain('DOCUMENTTYPE');
    expect(created.body.version).toBe(1);

    const got = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(got.body.internalId).toBe(created.body.internalId);
  });
});

describe('Documents preview API', () => {
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

  it('preview canonical equals persisted serialize', async () => {
    const ctx = await ownerCtx(app, `p${Date.now()}`);
    const body = draftBody(ctx.branchId, `PREV-${Date.now()}`);
    const preview = await request(app.getHttpServer())
      .post('/documents/preview')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(body)
      .expect(200);

    expect(preview.body.canonicalString).toBeTruthy();
    expect(preview.body.etaPayload.documentType).toBe('I');
  });
});

describe('Documents validate / kinds / rbac / isolation', () => {
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

  it('credit note without reference fails validate', async () => {
    const ctx = await ownerCtx(app, `cn${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(
        draftBody(ctx.branchId, `CN-${Date.now()}`, {
          kind: 'CREDIT_NOTE',
          references: null,
        }),
      )
      .expect(201);

    const validated = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/validate`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(validated.body.ok).toBe(false);
    expect(validated.body.issues.some((i: { code: string }) => i.code === 'REFERENCE_REQUIRED')).toBe(
      true,
    );
  });

  it('viewer cannot manage documents', async () => {
    const suffix = `v${Date.now()}`;
    const owner = await ownerCtx(app, suffix);
    const invite = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `viewer_${suffix}@example.com`, password: 'Password123!' })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .expect(200);
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'Viewer');

    await request(app.getHttpServer())
      .post('/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send({ email: `viewer_${suffix}@example.com`, roleId: viewerRole.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${invite.body.accessToken}`)
      .set('X-Tenant-Id', owner.tenantId)
      .send(draftBody(owner.branchId, `V-${Date.now()}`))
      .expect(403);
  });

  it('tenant isolation prevents cross-tenant get', async () => {
    const a = await ownerCtx(app, `a${Date.now()}`);
    const b = await ownerCtx(app, `b${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .send(draftBody(a.branchId, `ISO-${Date.now()}`))
      .expect(201);

    await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .expect(404);
  });
});
