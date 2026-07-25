import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadEnv } from '../src/config/env';

describe('Refresh cookie attributes (cross-origin)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const env = loadEnv();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableCors({
      origin: 'https://web.localhost',
      credentials: true,
    });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('login Set-Cookie is HttpOnly Path=/; refresh works with cookie', async () => {
    const email = `cookie_${Date.now()}@example.com`;
    const password = 'Password123!';

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', 'https://web.localhost')
      .send({ email, password })
      .expect(201);

    const setCookie = reg.headers['set-cookie'] as string[] | undefined;
    const refreshLine = setCookie?.find((c) =>
      c.startsWith(`${env.REFRESH_COOKIE_NAME}=`),
    );
    expect(refreshLine).toBeTruthy();
    expect(refreshLine!).toMatch(/HttpOnly/i);
    expect(refreshLine!).toMatch(/Path=\//i);
    expect(refreshLine!.toLowerCase()).not.toMatch(/domain=\.localhost/);

    if (env.COOKIE_SECURE) {
      expect(refreshLine!).toMatch(/Secure/i);
    }
    if (env.COOKIE_SAMESITE === 'none') {
      expect(refreshLine!).toMatch(/SameSite=None/i);
    }
    if (env.COOKIE_PARTITIONED) {
      expect(refreshLine!).toMatch(/Partitioned/i);
    }

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'https://web.localhost')
      .set('Cookie', refreshLine!)
      .expect(200);

    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.headers['access-control-allow-origin']).toBe(
      'https://web.localhost',
    );
    expect(refreshed.headers['access-control-allow-credentials']).toBe('true');

    await prisma.user.delete({ where: { email } }).catch(() => undefined);
  });
});
