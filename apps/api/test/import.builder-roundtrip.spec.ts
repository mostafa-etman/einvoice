import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  buildDocumentUpsert,
  groupRowsByInternalId,
} from '../src/imports/import-document-builder';
import { ImportsService } from '../src/imports/imports.service';
import * as XLSX from 'xlsx';

const COMPLETE_ADDRESS = {
  country: 'EG',
  governate: 'Cairo',
  regionCity: 'Nasr City',
  street: 'Abbas El Akkad',
  buildingNumber: '12',
};

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `impbld_${suffix}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);
  const token = reg.body.accessToken as string;
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `ImportBuilder ${suffix}` })
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
      taxpayerLegalName: 'Import Test Taxpayer LLC',
      issuerType: 'B',
    })
    .expect(200);

  return { token, tenantId, branchId };
}

describe('import builder produces markReady-valid invoices', () => {
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

  it('template XLSX has Import + Notes sheets and sample multi-line invoice', () => {
    const imports = app.get(ImportsService);
    const buf = imports.templateXlsx('I');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['Import', 'Notes']));
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      wb.Sheets.Import!,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.internalID).toBe(rows[1]!.internalID);
    expect(rows[0]!.taxType1).toBe('T1');
    expect(rows[0]!.taxSubType1).toBe('V009');
  });

  it('2-line import DTO create + markReady matches manual path', async () => {
    const ctx = await ownerCtx(app, `${Date.now()}`);
    const issued = new Date().toISOString();
    const internalId = `IMP-ML-${Date.now()}`;
    const rows = [
      {
        rowNumber: 1,
        mapped: {
          internalID: internalId,
          dateTimeIssued: issued,
          documentType: 'I',
          currencyCode: 'EGP',
          receiverType: 'B',
          receiverId: '111111111',
          receiverName: 'Buyer Co',
          receiverCountry: 'EG',
          receiverGovernate: 'Giza',
          receiverRegionCity: 'Dokki',
          receiverStreet: 'Tahrir',
          receiverBuildingNumber: '5',
          description: 'Consulting',
          itemType: 'EGS',
          itemCode: 'EGS-1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '100.00',
          taxType1: 'T1',
          taxSubType1: 'V009',
          taxRate1: '14',
        },
      },
      {
        rowNumber: 2,
        mapped: {
          internalID: internalId,
          dateTimeIssued: issued,
          documentType: 'I',
          currencyCode: 'EGP',
          receiverType: 'B',
          receiverId: '111111111',
          receiverName: 'Buyer Co',
          receiverCountry: 'EG',
          receiverGovernate: 'Giza',
          receiverRegionCity: 'Dokki',
          receiverStreet: 'Tahrir',
          receiverBuildingNumber: '5',
          description: 'Support',
          itemType: 'EGS',
          itemCode: 'EGS-1',
          unitType: 'EA',
          quantity: '2',
          unitPrice: '50.00',
          taxType1: 'T1',
          taxSubType1: 'V009',
          taxRate1: '14',
          taxType2: 'T4',
          taxSubType2: 'W001',
          taxRate2: '1',
        },
      },
    ];
    const groups = groupRowsByInternalId(rows);
    expect(groups).toHaveLength(1);
    const dto = buildDocumentUpsert(groups[0]!, {
      defaultBranchId: ctx.branchId,
      jobDocumentType: 'I',
    });
    expect(dto.lines).toHaveLength(2);
    expect(dto.issuer).toBeUndefined();

    const created = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send(dto)
      .expect(201);

    expect(created.body.etaPayload.issuer.name).toBe(
      'Import Test Taxpayer LLC',
    );
    expect(created.body.etaPayload.issuer.address).toMatchObject(
      COMPLETE_ADDRESS,
    );
    expect(created.body.lines).toHaveLength(2);

    await request(app.getHttpServer())
      .post(`/documents/${created.body.id}/mark-ready`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/documents/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);

    expect(detail.body.status).toBe('READY');
  });
});
