import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { UsageEmitService } from '../src/analytics/usage-emit.service';
import { DocumentStatusEventsService } from '../src/submissions/document-status-events.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { TenantPrismaService } from '../src/prisma/tenant-prisma.service';
import { bucketDateInTz } from '../src/analytics/usage-aggregate';
import { UsageEventService } from '../src/analytics/usage-event.service';

async function ownerCtx(app: INestApplication, suffix: string) {
  const email = `emit_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Emit ${suffix}` })
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
  return {
    token,
    tenantId,
    branchId: branches.body[0].id as string,
    userId: reg.body.user?.id as string | undefined,
  };
}

function minimalDocData(
  tenantId: string,
  branchId: string,
  internalId: string,
  status: 'SIGNED' | 'SUBMITTED' = 'SIGNED',
) {
  return {
    tenantId,
    branchId,
    kind: 'INVOICE' as const,
    status,
    currencyCode: 'EGP',
    issueDateTime: new Date(),
    internalId,
    version: 1,
    etaDocumentType: 'i',
    etaDocumentTypeVersion: '1.0',
    typeVersionFetchedAt: new Date(),
    issuerSnapshotJson: { type: 'B', id: '123' },
    etaPayloadJson: { dummy: true },
  };
}

describe('Analytics real emitters (T028–T037)', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Analytics emitters');
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

  it('issued + valid/invalid + received via real emit services match summary', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `${Date.now()}`);
    const emit = app.get(UsageEmitService);
    const statusEvents = app.get(DocumentStatusEventsService);
    const analytics = app.get(AnalyticsService);
    const tenantPrisma = app.get(TenantPrismaService);
    const day = bucketDateInTz(new Date(), 'Africa/Cairo');

    const docs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const doc = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
        tx.document.create({
          data: minimalDocData(
            ctx.tenantId,
            ctx.branchId,
            `EMIT-${Date.now()}-${i}`,
          ),
        }),
      );
      docs.push(doc.id);
      await emit.emitIssued({
        tenantId: ctx.tenantId,
        documentId: doc.id,
        branchId: ctx.branchId,
        currencyCode: 'EGP',
      });
    }

    await statusEvents.applyEtaStatus(ctx.tenantId, docs[0]!, 'Valid');
    await statusEvents.applyEtaStatus(ctx.tenantId, docs[1]!, 'Valid');
    await statusEvents.applyEtaStatus(ctx.tenantId, docs[2]!, 'Invalid');
    await statusEvents.applyEtaStatus(ctx.tenantId, docs[2]!, 'Valid');

    const received = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.receivedDocument.create({
        data: {
          tenantId: ctx.tenantId,
          documentUuid: `uuid-${Date.now()}`,
          kind: 'PURCHASE_INVOICE',
          etaDocumentType: 'i',
          currency: 'EGP',
          lastSyncedAt: new Date(),
        },
      }),
    );
    await emit.emitReceived({
      tenantId: ctx.tenantId,
      receivedDocumentId: received.id,
      currencyCode: 'EGP',
    });

    await emit.emitApiCall({
      tenantId: ctx.tenantId,
      path: '/test',
      method: 'GET',
    });
    await emit.emitApiCall({
      tenantId: ctx.tenantId,
      path: '/test',
      method: 'GET',
    });

    const cmp = await analytics.accuracyCompare({
      tenantId: ctx.tenantId,
      from: day,
      to: day,
    });
    expect(cmp.match).toBe(true);
    expect(cmp.fromEvents.issued).toBe(3);
    expect(cmp.fromEvents.received).toBe(1);
    expect(cmp.fromEvents.valid).toBe(3);
    expect(cmp.fromEvents.invalid).toBe(0);
    // explicit emits + interceptor from setup HTTP calls
    expect(cmp.fromEvents.api_calls).toBeGreaterThanOrEqual(2);

    const res = await request(app.getHttpServer())
      .get(`/analytics/summary?from=${day}&to=${day}`)
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(res.body.totals.issued).toBe(3);
    expect(res.body.totals.valid).toBe(3);
  });

  it('outcome supersede keeps a single valid/invalid per document', async () => {
    if (!dbAvailable) return;
    const ctx = await ownerCtx(app, `out-${Date.now()}`);
    const events = app.get(UsageEventService);
    const statusEvents = app.get(DocumentStatusEventsService);
    const tenantPrisma = app.get(TenantPrismaService);
    const doc = await tenantPrisma.withTenant(ctx.tenantId, (tx) =>
      tx.document.create({
        data: minimalDocData(
          ctx.tenantId,
          ctx.branchId,
          `OUT-${Date.now()}`,
          'SUBMITTED',
        ),
      }),
    );
    await statusEvents.applyEtaStatus(ctx.tenantId, doc.id, 'Invalid');
    await statusEvents.applyEtaStatus(ctx.tenantId, doc.id, 'Valid');
    const rows = await events.listInRange(
      ctx.tenantId,
      new Date(Date.now() - 86400000),
      new Date(Date.now() + 86400000),
    );
    const outcomes = rows.filter(
      (r) =>
        r.documentId === doc.id &&
        (r.meter === 'valid' || r.meter === 'invalid'),
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.meter).toBe('valid');
  });
});
