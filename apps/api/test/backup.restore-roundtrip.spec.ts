import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID, createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { EmptyOrgGuard } from '../src/backup/empty-org.guard';
import { BackupArchiveService } from '../src/backup/backup-archive.service';
import { SecretsEncryptionService } from '../src/crypto/secrets-encryption.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `bak_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Backup ${suffix}` })
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
    .send({ type: 'EGS', code: 'EGS-1', description: 'Backup item' })
    .expect(201);

  return {
    token,
    tenantId,
    branchId: branches.body[0].id as string,
    userId: reg.body.user?.id as string | undefined,
  };
}

async function seedFixtureDocs(
  tenantPrisma: TenantPrismaService,
  tenantId: string,
  branchId: string,
  count: number,
  prefix: string,
) {
  const ids: string[] = [];
  await tenantPrisma.withTenant(tenantId, async (tx) => {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      ids.push(id);
      await tx.document.create({
        data: {
          id,
          tenantId,
          kind: 'INVOICE',
          status: 'DRAFT',
          branchId,
          currencyCode: 'EGP',
          issueDateTime: new Date(),
          internalId: `${prefix}-${i}`,
          etaDocumentType: 'I',
          etaDocumentTypeVersion: '1.0',
          typeVersionFetchedAt: new Date(),
          issuerSnapshotJson: {},
          etaPayloadJson: {},
          taxTotalsJson: [],
        },
      });
      await tx.documentLine.create({
        data: {
          tenantId,
          documentId: id,
          lineNumber: 1,
          description: 'Service',
          itemType: 'EGS',
          itemCode: 'EGS-1',
          unitType: 'EA',
          quantity: '1',
          unitPrice: '10.00',
        },
      });
    }
  });
  return ids;
}


describe('Backup restore roundtrip GATE (T042)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Backup restore roundtrip');
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

  it('same-tenant wipe-then-restore matches fixed checklist + re-encrypts secrets', async () => {
    if (!dbAvailable) return;

    const suffix = `${Date.now()}`;
    const ctx = await ownerCtx(app, suffix);
    const emptyOrg = app.get(EmptyOrgGuard);
    const archive = app.get(BackupArchiveService);
    const secrets = app.get(SecretsEncryptionService);
    const tenantPrisma = app.get(TenantPrismaService);
    await secrets.ensureReady();

    // Seed ETA credential
    const enc = secrets.encrypt('eta-secret-value-xyz');
    const sourceCipher = Buffer.from(enc.ciphertext);
    const sourceNonce = Buffer.from(enc.nonce);
    await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenantEtaCredential.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: `client-${suffix}`,
          clientSecretCiphertext: enc.ciphertext,
          clientSecretNonce: enc.nonce,
        },
      }),
    );

    const docIds = await seedFixtureDocs(
      tenantPrisma,
      ctx.tenantId,
      ctx.branchId,
      3,
      `INT-${suffix}`,
    );

    // 2 storage objects
    const artifactIds: string[] = [];
    const fileBodies = [
      Buffer.from(`file-a-${suffix}`),
      Buffer.from(`file-b-${suffix}-longer`),
    ];
    const fileHashes = fileBodies.map((b) =>
      createHash('sha256').update(b).digest('hex'),
    );
    for (let i = 0; i < 2; i++) {
      const key = `tenants/${ctx.tenantId}/artifacts/backups/fixture-${i}.bin`;
      const storage = app.get('ArtifactStorage') as {
        putByKey: (k: string, b: Buffer, c: string) => Promise<unknown>;
      };
      await storage.putByKey(key, fileBodies[i], 'application/octet-stream');
      const art = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
        tx.documentArtifact.create({
          data: {
            tenantId: ctx.tenantId,
            documentId: docIds[i],
            kind: 'fixture',
            minioBucket: 'einvoice',
            minioKey: key,
            contentType: 'application/octet-stream',
            byteSize: fileBodies[i].length,
          },
        }),
      );
      artifactIds.push(art.id);
    }

    const itemBefore = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.itemCode.findFirst({ where: { tenantId: ctx.tenantId, code: 'EGS-1' } }),
    );
    expect(itemBefore).toBeTruthy();

    const backup = await request(app.getHttpServer())
      .post('/backup/jobs')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(202);

    expect(backup.body.status).toBe('COMPLETED');
    expect(backup.body.checksumSha256).toBeTruthy();

    // Peek: A docs present
    const peek = await archive.peekPayload(
      (
        await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
          tx.tenantBackupJob.findUniqueOrThrow({ where: { id: backup.body.id } }),
        )
      ).objectKey!,
      backup.body.checksumSha256,
    );
    expect(peek.documents).toHaveLength(3);
    expect(peek.artifacts).toHaveLength(2);
    expect(peek.etaCredentials).toHaveLength(1);

    await emptyOrg.wipeOperationalData(ctx.tenantId);
    const emptied = await emptyOrg.assertEmpty(ctx.tenantId);
    expect(emptied.empty).toBe(true);

    await request(app.getHttpServer())
      .post('/backup/restores')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ backupJobId: backup.body.id, confirmation: 'RESTORE' })
      .expect(202);

    const docsAfter = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { internalId: 'asc' },
      }),
    );
    expect(docsAfter).toHaveLength(3);
    expect(docsAfter.map((d) => d.id).sort()).toEqual([...docIds].sort());

    const arts = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.documentArtifact.findMany({ where: { tenantId: ctx.tenantId } }),
    );
    expect(arts).toHaveLength(2);
    const storage = app.get('ArtifactStorage') as {
      getByKey: (k: string) => Promise<Buffer>;
    };
    for (let i = 0; i < 2; i++) {
      const art = arts.find((a) => a.id === artifactIds[i])!;
      const body = await storage.getByKey(art.minioKey);
      expect(createHash('sha256').update(body).digest('hex')).toBe(fileHashes[i]);
    }

    const itemAfter = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.itemCode.findFirst({ where: { tenantId: ctx.tenantId, code: 'EGS-1' } }),
    );
    expect(itemAfter?.id).toBe(itemBefore!.id);

    const cred = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.tenantEtaCredential.findFirst({ where: { tenantId: ctx.tenantId } }),
    );
    expect(cred).toBeTruthy();
    const newCipher = Buffer.from(cred!.clientSecretCiphertext);
    const newNonce = Buffer.from(cred!.clientSecretNonce);
    expect(newCipher.equals(sourceCipher)).toBe(false);
    expect(newNonce.equals(sourceNonce)).toBe(false);
    expect(secrets.decrypt(newCipher, newNonce)).toBe('eta-secret-value-xyz');

    // Export must not contain secrets
    const exp = await request(app.getHttpServer())
      .post('/backup/exports')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .send({ includeFiles: false })
      .expect(202);
    const zip = await request(app.getHttpServer())
      .get(`/backup/exports/${exp.body.id}/download`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    const zipText = zip.body.toString('utf8');
    expect(zipText).not.toContain('eta-secret-value-xyz');
    expect(zipText).not.toContain('clientSecret');
    expect(zipText.toLowerCase()).not.toContain('pin');
  });
});
