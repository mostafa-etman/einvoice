import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { SecretsEncryptionService } from '../src/crypto/secrets-encryption.service';

/**
 * DEDICATED — Stored credential encryption inspection (T027).
 * Must hit real Postgres; do not mock persistence.
 */
describe('ETA credentials ciphertext at rest (T027)', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let crypto: SecretsEncryptionService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    tenantPrisma = app.get(TenantPrismaService);
    crypto = app.get(SecretsEncryptionService);
    await crypto.ensureReady();
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists ciphertext+nonce that do not contain plaintext; decrypt only in memory', async () => {
    const suffix = Date.now();
    const email = `cipher_${suffix}@example.com`;
    const password = 'Password123!';
    const plaintext = `must-not-appear-in-db-${suffix}`;

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Cipher User' })
      .expect(201);
    const tenant = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name: `Cipher Tenant ${suffix}` })
      .expect(201);

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .set('X-Tenant-Id', tenant.body.id)
      .send({
        clientId: 'cipher-client',
        clientSecret: plaintext,
        registrationNumber: '999',
      })
      .expect(200);

    const row = await tenantPrisma.withTenant(tenant.body.id, (tx) =>
      tx.tenantEtaCredential.findFirst({
        where: { tenantId: tenant.body.id, branchId: null },
      }),
    );

    expect(row).toBeTruthy();
    expect(
      Buffer.isBuffer(row!.clientSecretCiphertext) ||
        row!.clientSecretCiphertext instanceof Uint8Array,
    ).toBe(true);
    expect(row!.clientSecretCiphertext.length).toBeGreaterThan(0);
    expect(row!.clientSecretNonce.length).toBeGreaterThan(0);

    const asUtf8 = Buffer.from(row!.clientSecretCiphertext).toString('utf8');
    const asHex = Buffer.from(row!.clientSecretCiphertext).toString('hex');
    expect(asUtf8).not.toContain(plaintext);
    expect(asHex).not.toContain(Buffer.from(plaintext).toString('hex'));

    const recovered = crypto.decrypt(
      row!.clientSecretCiphertext,
      row!.clientSecretNonce,
    );
    expect(recovered).toBe(plaintext);
  });
});
