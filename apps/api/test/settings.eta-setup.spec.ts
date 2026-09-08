import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';

async function registerTenant(app: INestApplication, suffix: string) {
  const email = `etasetup_${suffix}@example.com`;
  const password = 'Password123!';
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password, name: 'Setup User' })
    .expect(201);
  const tenant = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${reg.body.accessToken}`)
    .send({ name: `Setup Tenant ${suffix}` })
    .expect(201);
  return {
    token: tenant.body.accessToken as string,
    tenantId: tenant.body.id as string,
  };
}

describe('ETA first-login setup prompt', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('ETA first-login setup prompt');
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

  it('prompts a new tenant until dismissed, and hides an empty tutorial URL', async () => {
    if (!dbAvailable) return;
    const ctx = await registerTenant(app, String(Date.now()));
    const auth = { Authorization: `Bearer ${ctx.token}`, 'X-Tenant-Id': ctx.tenantId };

    const before = await request(app.getHttpServer())
      .get('/settings/eta-credentials/setup')
      .set(auth)
      .expect(200);
    expect(before.body.etaConfigured).toBe(false);
    expect(before.body.promptDismissed).toBe(false);
    expect(before.body.promptEtaSetup).toBe(true);
    expect(before.body.tutorialVideoUrl).toBeFalsy();

    const dismissed = await request(app.getHttpServer())
      .post('/settings/eta-credentials/dismiss-setup-prompt')
      .set(auth)
      .send({})
      .expect(200);
    expect(dismissed.body.promptDismissed).toBe(true);
    expect(dismissed.body.promptEtaSetup).toBe(false);

    const after = await request(app.getHttpServer())
      .get('/settings/eta-credentials/setup')
      .set(auth)
      .expect(200);
    expect(after.body.promptEtaSetup).toBe(false);
    expect(after.body.promptDismissed).toBe(true);
  });

  it('exposes a configured tutorial URL from platform settings', async () => {
    if (!dbAvailable) return;
    const ctx = await registerTenant(app, `vid${Date.now()}`);
    const prisma = app.get(PrismaService);
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    await prisma.platformSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', etaTutorialVideoUrl: url },
      update: { etaTutorialVideoUrl: url },
    });

    const res = await request(app.getHttpServer())
      .get('/settings/eta-credentials/setup')
      .set('Authorization', `Bearer ${ctx.token}`)
      .set('X-Tenant-Id', ctx.tenantId)
      .expect(200);
    expect(res.body.tutorialVideoUrl).toBe(url);

    await prisma.platformSettings.update({
      where: { id: 'default' },
      data: { etaTutorialVideoUrl: null },
    });
  });

  it('stops prompting after ETA credentials are saved', async () => {
    if (!dbAvailable) return;
    const ctx = await registerTenant(app, `cred${Date.now()}`);
    const auth = { Authorization: `Bearer ${ctx.token}`, 'X-Tenant-Id': ctx.tenantId };

    await request(app.getHttpServer())
      .put('/settings/eta-credentials')
      .set(auth)
      .send({
        clientId: 'client-setup',
        clientSecret: `secret-${Date.now()}`,
        registrationNumber: '123456789',
        taxpayerLegalName: 'Setup Co Legal',
        issuerType: 'B',
        activityCode: '1000',
        isIntermediary: false,
      })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/settings/eta-credentials/setup')
      .set(auth)
      .expect(200);
    expect(after.body.etaConfigured).toBe(true);
    expect(after.body.promptEtaSetup).toBe(false);
  });
});
