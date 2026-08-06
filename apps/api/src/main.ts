import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { loadApiDotEnv } from './config/load-api-dotenv';
import { AppModule } from './app.module';
import { getCorsOrigins, loadEnv } from './config/env';

loadApiDotEnv();

async function bootstrap() {
  const env = loadEnv();
  // rawBody is required to verify the Stripe webhook signature (billing-webhook.controller.ts).
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Id',
      'Accept',
      'Idempotency-Key',
    ],
    // The printout/source downloads read the filename from this header.
    exposedHeaders: ['Content-Disposition'],
    optionsSuccessStatus: 204,
  });

  await app.listen(env.PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
