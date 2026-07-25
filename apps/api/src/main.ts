import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getCorsOrigins, loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  const allowedOrigins = getCorsOrigins(env);

  app.enableCors({
    // Explicit origin reflection — never '*" when credentials are used.
    origin: (requestOrigin, callback) => {
      if (!requestOrigin) {
        // Non-browser / same-origin tools (curl, health checks)
        callback(null, true);
        return;
      }
      if (allowedOrigins === true || allowedOrigins.includes(requestOrigin)) {
        callback(null, requestOrigin);
        return;
      }
      callback(new Error(`CORS blocked origin: ${requestOrigin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'Accept'],
    exposedHeaders: [],
    optionsSuccessStatus: 204,
  });

  await app.listen(env.PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
