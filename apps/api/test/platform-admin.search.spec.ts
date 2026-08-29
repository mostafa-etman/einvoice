import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isDatabaseAvailable, skipMessage } from './db-guard';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Platform-admin tenant search', () => {
  let app: INestApplication;
  let dbAvailable = true;

  beforeAll(async () => {
    dbAvailable = await isDatabaseAvailable();
    if (!dbAvailable) {
      skipMessage('Platform-admin tenant search');
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

  it('finds a tenant by id, company name, or owner email', async () => {
    if (!dbAvailable) return;
    const t = Date.now();
    const email = `search_op_${t}@example.com`;
    const password = 'Password123!';
    const name = `Searchable Co ${t}`;

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Search Owner' })
      .expect(201);

    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: reg.body.user.id },
      data: { isPlatformOperator: true },
    });

    const created = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name, planCode: 'FREE' })
      .expect(201);
    const tenantId = created.body.id as string;
    const token = created.body.accessToken ?? (reg.body.accessToken as string);

    const byId = await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .query({ q: tenantId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byId.body.items.some((row: { id: string }) => row.id === tenantId)).toBe(true);

    const byName = await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .query({ q: name })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byName.body.items.some((row: { id: string }) => row.id === tenantId)).toBe(true);

    const byEmail = await request(app.getHttpServer())
      .get('/platform-admin/tenants')
      .query({ q: email })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byEmail.body.items.some((row: { id: string }) => row.id === tenantId)).toBe(true);
  });
});
