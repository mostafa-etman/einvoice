process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '3001';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://einvoice_app:einvoice_app@localhost:5432/einvoice?schema=public';
process.env.MIGRATE_DATABASE_URL =
  process.env.MIGRATE_DATABASE_URL ||
  'postgresql://einvoice:einvoice@localhost:5432/einvoice?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
process.env.MINIO_PORT = process.env.MINIO_PORT || '9000';
process.env.MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
process.env.MINIO_USE_SSL = process.env.MINIO_USE_SSL || 'false';
process.env.ETA_IDENTITY_BASE_URL =
  process.env.ETA_IDENTITY_BASE_URL || 'https://id.preprod.eta.gov.eg';
process.env.ETA_API_BASE_URL =
  process.env.ETA_API_BASE_URL ||
  'https://api.preprod.invoicing.eta.gov.eg';
process.env.ETA_BASE_URL =
  process.env.ETA_BASE_URL || process.env.ETA_API_BASE_URL;
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test-access-secret-min-16';
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
process.env.REFRESH_COOKIE_NAME = 'refresh_token';
process.env.REFRESH_TTL_DAYS = '14';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';
process.env.COOKIE_PARTITIONED = 'false';
delete process.env.COOKIE_DOMAIN;
process.env.CORS_ORIGINS = 'https://web.localhost,http://localhost:3000';
process.env.SECRETS_MASTER_KEY =
  process.env.SECRETS_MASTER_KEY ||
  Buffer.from('test-secrets-master-key-32bytes!').toString('base64');
