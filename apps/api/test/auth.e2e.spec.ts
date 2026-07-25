import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadEnv } from '../src/config/env';

describe('Auth API e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const env = loadEnv();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('register, login, refresh rotates cookie, logout', async () => {
    const email = `auth_${Date.now()}@example.com`;
    const password = 'Password123!';

    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Auth User' })
      .expect(201);

    expect(register.body.accessToken).toBeTruthy();
    const refresh1 = register.headers['set-cookie']?.find((c: string) =>
      c.startsWith(`${env.REFRESH_COOKIE_NAME}=`),
    );
    expect(refresh1).toBeTruthy();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    const refresh2 = login.headers['set-cookie']?.find((c: string) =>
      c.startsWith(`${env.REFRESH_COOKIE_NAME}=`),
    );

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refresh2!)
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    const refresh3 = refreshed.headers['set-cookie']?.find((c: string) =>
      c.startsWith(`${env.REFRESH_COOKIE_NAME}=`),
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refresh2!)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .set('Cookie', refresh3!)
      .expect(204);

    await prisma.user.delete({ where: { email } }).catch(() => undefined);
  });
});
