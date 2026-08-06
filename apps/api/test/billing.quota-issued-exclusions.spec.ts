import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { QuotaService } from '../src/billing/quota.service';
import { UsageEmitService } from '../src/analytics/usage-emit.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `qi_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `QuotaIssued ${suffix}` })
    .expect(201);
  return { token: reg.body.accessToken as string, tenantId: tenant.body.id as string };
}

/**
 * QuotaService.getUsage() sources `documents` from the `issued` meter, which
 * is only ever emitted once per document at issuance and is never removed by
 * a later valid/invalid outcome (011-usage-analytics: `valid`/`invalid` are a
 * separate, superseding outcome meter). So a document going INVALID after
 * issuance must not change the tenant's document quota usage.
 */
describe('Quota document usage tracks the issued meter, unaffected by valid/invalid outcome', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Billing quota-issued-exclusions');
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

  it('marking an issued document INVALID does not reduce (or double count) document quota usage', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, String(Date.now()));
    const quota = app.get(QuotaService);
    const emit = app.get(UsageEmitService);
    const documentId = randomUUID();

    const before = await quota.getUsage(ctx.tenantId);
    expect(before.documents).toBe(0);

    await emit.emitIssued({ tenantId: ctx.tenantId, documentId });

    const afterIssued = await quota.getUsage(ctx.tenantId);
    expect(afterIssued.documents).toBe(1);

    await emit.emitDocumentOutcome({ tenantId: ctx.tenantId, documentId, toStatus: 'INVALID' });

    const afterInvalid = await quota.getUsage(ctx.tenantId);
    expect(afterInvalid.documents).toBe(1);

    // Re-emitting "issued" for the same document is idempotent (unique per documentId) —
    // usage must still read 1, not 2.
    await emit.emitIssued({ tenantId: ctx.tenantId, documentId });
    const afterReemit = await quota.getUsage(ctx.tenantId);
    expect(afterReemit.documents).toBe(1);

    const snapshot = await quota.getQuotaSnapshot(ctx.tenantId);
    expect(snapshot.documents).toEqual({ used: 1, limit: 100 });
  });
});
