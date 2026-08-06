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
  const email = `issaddr_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `IssuerAddr ${suffix}` })
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

  return { token, tenantId, branchId: branches.body[0].id as string };
}

function draftBody(
  branchId: string,
  internalId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: 'INVOICE',
    branchId,
    currencyCode: 'EGP',
    issueDateTime: new Date().toISOString(),
    internalId,
    version: 0,
    taxpayerActivityCode: '4620',
    receiver: {
      type: 'B',
      id: '111111111',
      name: 'Buyer Co',
      address: {
        country: 'EG',
        governate: 'Giza',
        regionCity: 'Dokki',
        street: 'Tahrir',
        buildingNumber: '5',
      },
    },
    lines: [
      {
        description: 'Service',
        itemType: 'EGS',
        itemCode: 'EGS-1',
        unitType: 'EA',
        quantity: '1',
        unitPrice: '100.00',
        discountAmount: '0.00',
        taxes: [{ taxType: 'T1', subType: 'V009', rate: '14.00' }],
      },
    ],
    ...overrides,
  };
}

describe('Issuer address flows from branch settings into documents', () => {
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

  it('rejects a branch whose issuer address is incomplete', async () => {
    const ctx = await ownerCtx(app, `bad${Date.now()}`);
    const res = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        name: 'Incomplete',
        address: { country: 'EG', governate: 'Cairo' },
      })
      .expect(400);

    expect(res.body.code).toBe('ISSUER_ADDRESS_INCOMPLETE');
    expect(res.body.missing).toEqual(
      expect.arrayContaining(['regionCity', 'street', 'buildingNumber']),
    );
  });

  it('flags an incomplete branch address as fixable in settings, not on the invoice', async () => {
    const ctx = await ownerCtx(app, `hint${Date.now()}`);
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `HINT-${Date.now()}`))
      .expect(201);

    const validated = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/validate`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const issuerIssues = validated.body.issues.filter((i: { path: string }) =>
      i.path?.startsWith('issuer.address.'),
    );
    expect(issuerIssues.length).toBeGreaterThan(0);
    for (const issue of issuerIssues) {
      expect(issue.fixIn).toBe('settings');
      expect(issue.settingsArea).toBe('branches');
      expect(issue.message).toContain('Settings → Branches');
    }

    // The registration number is company-level too, but lives in the ETA connection.
    const registration = validated.body.issues.find(
      (i: { path: string }) => i.path === 'issuer.id',
    );
    expect(registration.settingsArea).toBe('eta-credentials');
    expect(registration.message).toContain('Settings → ETA connection');
  });

  it('inherits the branch address so an invoice validates and can be marked ready', async () => {
    const ctx = await ownerCtx(app, `ok${Date.now()}`);
    const patched = await request(app.getHttpServer())
      .patch(`/branches/${ctx.branchId}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ address: COMPLETE_ADDRESS, activityCode: '4620' })
      .expect(200);
    expect(patched.body.addressComplete).toBe(true);

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        registrationNumber: '999999999',
        activityCode: '4620',
        taxpayerLegalName: 'Acme Trading LLC',
        issuerType: 'B',
      })
      .expect(200);

    // No issuer block at all — the document must inherit it from settings.
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `OK-${Date.now()}`))
      .expect(201);

    expect(created.body.etaPayload.issuer.address).toMatchObject(COMPLETE_ADDRESS);
    expect(created.body.etaPayload.issuer.name).toBe('Acme Trading LLC');
    expect(created.body.etaPayload.issuer.name).not.toBe('Main');
    expect(created.body.etaPayload.issuer.id).toBe('999999999');
    expect(created.body.etaPayload.issuer.type).toBe('B');

    const validated = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/validate`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    const issuerRequired = validated.body.issues.filter(
      (i: { code: string; path: string }) =>
        i.code === 'REQUIRED_FIELD' && i.path?.startsWith('issuer.'),
    );
    expect(issuerRequired).toEqual([]);
    expect(validated.body.ok).toBe(true);

    const ready = await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/mark-ready`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);
    expect(ready.body.status).toBe('READY');
  });

  it('never puts the branch name into issuer.name, and flags leftover Main', async () => {
    const ctx = await ownerCtx(app, `main${Date.now()}`);
    await request(app.getHttpServer())
      .patch(`/branches/${ctx.branchId}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ address: COMPLETE_ADDRESS })
      .expect(200);

    // Create without company legal name → issuer.name stays empty (not "Main").
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(draftBody(ctx.branchId, `MAIN-${Date.now()}`))
      .expect(201);
    expect(created.body.etaPayload.issuer.name).toBe('');
    expect(created.body.etaPayload.issuer.name).not.toMatch(/main/i);

    // Explicit leftover "Main" on save is stripped (treated as blank), so the
    // payload never keeps the branch label — validate then requires a real name.
    const leftover = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(
        draftBody(ctx.branchId, `MAIN2-${Date.now()}`, {
          issuer: { type: 'B', name: 'Main', id: '111' },
        }),
      )
      .expect(201);
    expect(leftover.body.etaPayload.issuer.name).toBe('');
    expect(leftover.body.etaPayload.issuer.name).not.toMatch(/main/i);

    const validated = await request(app.getHttpServer())
      .post(`/documents/${leftover.body.id}/validate`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const nameIssue = validated.body.issues.find(
      (i: { path: string; code: string }) =>
        i.path === 'issuer.name' &&
        (i.code === 'REQUIRED_FIELD' || i.code === 'ISSUER_NAME_PLACEHOLDER'),
    );
    expect(nameIssue).toBeTruthy();
    expect(nameIssue.settingsArea).toBe('eta-credentials');
    expect(nameIssue.message).toContain('Settings → ETA connection');
  });

  it('keeps per-invoice overrides on save and never lets a blank field erase settings', async () => {
    const ctx = await ownerCtx(app, `ovr${Date.now()}`);
    await request(app.getHttpServer())
      .patch(`/branches/${ctx.branchId}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ address: COMPLETE_ADDRESS })
      .expect(200);
    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        registrationNumber: '999999999',
        taxpayerLegalName: 'Acme Trading LLC',
      })
      .expect(200);

    const internalId = `OVR-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(
        draftBody(ctx.branchId, internalId, {
          issuer: {
            type: 'B',
            name: 'Overridden Co',
            address: {
              street: 'Corniche El Nil',
              // Blank fields must fall back to settings, not blank the address.
              governate: '',
              regionCity: '   ',
              buildingNumber: '',
            },
          },
        }),
      )
      .expect(201);

    const savedAddress = created.body.etaPayload.issuer.address;
    expect(savedAddress.street).toBe('Corniche El Nil');
    expect(savedAddress.governate).toBe('Cairo');
    expect(savedAddress.regionCity).toBe('Nasr City');
    expect(savedAddress.buildingNumber).toBe('12');

    // The override must survive a reload and a subsequent update.
    const reloaded = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(reloaded.body.etaPayload.issuer.address.street).toBe('Corniche El Nil');

    const updated = await request(app.getHttpServer())
      .put(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(
        draftBody(ctx.branchId, internalId, {
          version: reloaded.body.version,
          issuer: {
            type: 'B',
            name: 'Overridden Co',
            address: { ...COMPLETE_ADDRESS, street: 'Corniche El Nil' },
          },
        }),
      )
      .expect(200);
    expect(updated.body.etaPayload.issuer.address.street).toBe('Corniche El Nil');
  });
});
