import { loadEnv } from '../src/config/env';

describe('ETA config (mocked)', () => {
  it('resolved URLs never hardcode production-only hosts as sole default in test', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: '9000',
      MINIO_ACCESS_KEY: 'x',
      MINIO_SECRET_KEY: 'x',
      MINIO_USE_SSL: 'false',
      JWT_ACCESS_SECRET: 'test-access-secret-min-16',
    });
    expect(env.ETA_IDENTITY_BASE_URL).toMatch(/preprod|sandbox/i);
    expect(env.ETA_API_BASE_URL).toMatch(/preprod|sandbox/i);
    expect(env.ETA_IDENTITY_BASE_URL).not.toBe(
      'https://id.eta.gov.eg',
    );
  });

  it('fails closed in production without identity+api URLs', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        PORT: '3001',
        DATABASE_URL: 'postgresql://x',
        REDIS_URL: 'redis://x',
        MINIO_ENDPOINT: 'localhost',
        MINIO_PORT: '9000',
        MINIO_ACCESS_KEY: 'x',
        MINIO_SECRET_KEY: 'x',
        MINIO_USE_SSL: 'false',
        JWT_ACCESS_SECRET: 'test-access-secret-min-16',
        SECRETS_MASTER_KEY: Buffer.from(
          'test-secrets-master-key-32bytes!',
        ).toString('base64'),
        ETA_BASE_URL: 'https://api.preprod.invoicing.eta.gov.eg',
      }),
    ).toThrow(/ETA_IDENTITY_BASE_URL|ETA_API_BASE_URL/);
  });
});
