import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerTenant(app: INestApplication, suffix: string) {
  const email = `eta_env_${suffix}@example.com`;
  const password = 'Password123!';
  const legalName = `Acme Legal ${suffix}`;
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'ETA Env User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Acme Env ${suffix}` })
    .expect(201);
  return {
    token: reg.body.accessToken as string,
    tenantId: tenant.body.id as string,
    legalName,
  };
}

describe('ETA environment switch + sandbox clear', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    tenantPrisma = app.get(TenantPrismaService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores separate creds, gates production switch, clears sandbox only', async () => {
    const ctx = await registerTenant(app, String(Date.now()));

    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { legalName: ctx.legalName },
    });

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        environment: 'SANDBOX',
        clientId: 'sandbox-client',
        clientSecret: 'sandbox-secret',
        registrationNumber: '111111111',
        taxpayerLegalName: ctx.legalName,
        issuerType: 'B',
      })
      .expect(200);

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({
        environment: 'PRODUCTION',
        clientId: 'prod-client',
        clientSecret: 'prod-secret',
        registrationNumber: '111111111',
        taxpayerLegalName: ctx.legalName,
        issuerType: 'B',
      })
      .expect(200);

    const sandboxGet = await request(app.getHttpServer())
      .get('/settings/eta-credentials?environment=SANDBOX')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const prodGet = await request(app.getHttpServer())
      .get('/settings/eta-credentials?environment=PRODUCTION')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(sandboxGet.body.clientId).toBe('sandbox-client');
    expect(prodGet.body.clientId).toBe('prod-client');
    expect(sandboxGet.body.environment).toBe('SANDBOX');
    expect(prodGet.body.environment).toBe('PRODUCTION');

    const blocked = await request(app.getHttpServer())
      .put('/settings/eta-environment')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ environment: 'PRODUCTION' })
      .expect(400);
    expect(blocked.body.message ?? blocked.body.code).toBeTruthy();

    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenantEtaCredential.updateMany({
        where: { tenantId: ctx.tenantId, environment: 'PRODUCTION' },
        data: { lastValidatedAt: new Date() },
      }),
    );

    const switched = await request(app.getHttpServer())
      .put('/settings/eta-environment')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ environment: 'PRODUCTION' })
      .expect(200);
    expect(switched.body.activeEnvironment).toBe('PRODUCTION');

    const branch = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.branch.findFirst({ where: { tenantId: ctx.tenantId } }),
    );
    expect(branch).toBeTruthy();

    await tenantPrisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.document.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch!.id,
          kind: 'INVOICE',
          status: 'DRAFT',
          currencyCode: 'EGP',
          issueDateTime: new Date(),
          internalId: `SBX-${Date.now()}`,
          version: 1,
          etaDocumentType: 'i',
          etaDocumentTypeVersion: '1.0',
          typeVersionFetchedAt: new Date(),
          issuerSnapshotJson: { type: 'B', id: '123' },
          etaPayloadJson: { dummy: true },
          etaEnvironment: 'SANDBOX',
        },
      });
      await tx.document.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: branch!.id,
          kind: 'INVOICE',
          status: 'VALID',
          currencyCode: 'EGP',
          issueDateTime: new Date(),
          internalId: `PRD-${Date.now()}`,
          version: 1,
          etaDocumentType: 'i',
          etaDocumentTypeVersion: '1.0',
          typeVersionFetchedAt: new Date(),
          issuerSnapshotJson: { type: 'B', id: '123' },
          etaPayloadJson: { dummy: true },
          etaEnvironment: 'PRODUCTION',
          etaUuid: 'prod-uuid-keep',
          etaStatus: 'Valid',
        },
      });
    });

    await request(app.getHttpServer())
      .post('/settings/eta-environment/clear-sandbox')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ confirmation: 'wrong' })
      .expect(400);

    const cleared = await request(app.getHttpServer())
      .post('/settings/eta-environment/clear-sandbox')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ confirmation: ctx.legalName })
      .expect(200);

    expect(cleared.body.deletedDocuments).toBe(1);

    const remaining = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.findMany({ where: { tenantId: ctx.tenantId } }),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.etaEnvironment).toBe('PRODUCTION');
    expect(remaining[0]!.etaUuid).toBe('prod-uuid-keep');

    const creds = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenantEtaCredential.findMany({ where: { tenantId: ctx.tenantId } }),
    );
    expect(creds.length).toBeGreaterThanOrEqual(2);

    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
    });
    expect(tenant?.legalName).toBe(ctx.legalName);
    expect(tenant?.activeEtaEnvironment).toBe('PRODUCTION');

    const audits = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: ctx.tenantId,
          action: 'settings.sandbox_data.clear',
        },
      }),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.metadata).toMatchObject({
      deletedDocuments: 1,
      irreversible: true,
    });
  });
});
