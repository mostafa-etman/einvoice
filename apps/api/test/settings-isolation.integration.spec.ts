import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

describe('Settings cross-tenant isolation (T045)', () => {
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

  it('tenant A cannot read tenant B settings rows (RLS + HTTP)', async () => {
    const suffix = Date.now();
    const password = 'Password123!';

    const regA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `iso_a_${suffix}@example.com`, password })
      .expect(201);
    const regB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `iso_b_${suffix}@example.com`, password })
      .expect(201);

    const tenantA = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regA.body.accessToken}`)
        .send({ name: `Iso A ${suffix}` })
        .expect(201)
    ).body;
    const tenantB = (
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${regB.body.accessToken}`)
        .send({ name: `Iso B ${suffix}` })
        .expect(201)
    ).body;

    await request(app.getHttpServer())
      .post('/currencies')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({ currencyCode: 'EUR', isDefault: true })
      .expect(201);

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({
        clientId: 'b-client',
        clientSecret: 'b-secret-value',
        registrationNumber: 'B-REG',
        taxpayerLegalName: `Iso B Legal ${suffix}`,
        issuerType: 'B',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/item-codes')
      .set('Authorization', `Bearer ${regB.body.accessToken}`)
      .set('X-Tenant-Id', tenantB.id)
      .send({ type: 'GS1', code: 'B-ONLY', description: 'B item' })
      .expect(201);

    await tenantPrisma.withTenant(tenantA.id, async (tx) => {
      const currencies = await tx.tenantCurrency.findMany();
      expect(currencies.every((c) => c.tenantId === tenantA.id)).toBe(true);
      expect(currencies.some((c) => c.tenantId === tenantB.id)).toBe(false);

      const creds = await tx.tenantEtaCredential.findMany();
      expect(creds.every((c) => c.tenantId === tenantA.id)).toBe(true);
      expect(creds.some((c) => c.tenantId === tenantB.id)).toBe(false);

      const items = await tx.itemCode.findMany();
      expect(items.every((i) => i.tenantId === tenantA.id)).toBe(true);
      expect(items.some((i) => i.tenantId === tenantB.id)).toBe(false);

      const rates = await tx.exchangeRate.findMany();
      expect(rates.every((r) => r.tenantId === tenantA.id)).toBe(true);
    });

    const itemsA = await request(app.getHttpServer())
      .get('/item-codes')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    expect(itemsA.body.some((i: { code: string }) => i.code === 'B-ONLY')).toBe(
      false,
    );

    const etaA = await request(app.getHttpServer())
      .get('/settings/eta-credentials')
      .set('Authorization', `Bearer ${regA.body.accessToken}`)
      .set('X-Tenant-Id', tenantA.id)
      .expect(200);
    expect(etaA.body === null || etaA.body.clientId !== 'b-client').toBe(true);
  });
});
