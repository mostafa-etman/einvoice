import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { BackupArchiveService } from '../src/backup/backup-archive.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `iso_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Iso ${suffix}` })
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
    .send({ type: 'EGS', code: 'EGS-1', description: 'Item' })
    .expect(201);
  return { token, tenantId, branchId: branches.body[0].id as string };
}

async function seedDoc(
  tenantPrisma: TenantPrismaService,
  tenantId: string,
  branchId: string,
  internalId: string,
) {
  const id = randomUUID();
  await tenantPrisma.withTenant(tenantId, async (tx) => {
    await tx.document.create({
      data: {
        id,
        tenantId,
        kind: 'INVOICE',
        status: 'DRAFT',
        branchId,
        currencyCode: 'EGP',
        issueDateTime: new Date(),
        internalId,
        etaDocumentType: 'I',
        etaDocumentTypeVersion: '1.0',
        typeVersionFetchedAt: new Date(),
        issuerSnapshotJson: {},
        etaPayloadJson: {},
        taxTotalsJson: [],
      },
    });
  });
  return id;
}

describe('Backup cross-tenant isolation GATE (T043)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Backup cross-tenant');
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

  it('denies cross-tenant download/restore and decrypt proves A present / B absent', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const a = await ownerCtx(app, `a${t}`);
    const b = await ownerCtx(app, `b${t}`);
    const tenantPrisma = app.get(TenantPrismaService);
    const archive = app.get(BackupArchiveService);

    const docA = await seedDoc(tenantPrisma, a.tenantId, a.branchId, `A-${t}`);
    const docB = await seedDoc(tenantPrisma, b.tenantId, b.branchId, `B-${t}`);

    const bakA = await request(app.getHttpServer())
      .post('/backup/jobs')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', a.tenantId)
      .expect(202);

    await request(app.getHttpServer())
      .get(`/backup/jobs/${bakA.body.id}/download`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .expect((res) => {
        expect([403, 404]).toContain(res.status);
      });

    await request(app.getHttpServer())
      .post('/backup/restores')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', b.tenantId)
      .send({ backupJobId: bakA.body.id, confirmation: 'RESTORE' })
      .expect((res) => {
        expect([400, 403, 404]).toContain(res.status);
      });

    const job = await tenantPrisma.withTenant(a.tenantId, (tx) =>
      tx.tenantBackupJob.findUniqueOrThrow({ where: { id: bakA.body.id } }),
    );
    const payload = await archive.peekPayload(job.objectKey!, job.checksumSha256!);
    const ids = payload.documents.map((d) => String(d.id));
    expect(ids).toContain(docA);
    expect(ids).not.toContain(docB);
  });

  it('operator restore without flag is denied', async () => {
    if (!dbAvailable) return;
    const a = await ownerCtx(app, `op${Date.now()}`);
    await request(app.getHttpServer())
      .post('/backup/operator/restores')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        targetTenantId: a.tenantId,
        sourceObjectKey: 'x',
        expectedChecksumSha256: 'y',
        sourceTenantId: a.tenantId,
        confirmation: 'RESTORE',
      })
      .expect(403);
  });
});
