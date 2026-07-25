import { buildRefreshSerializeOptions } from './refresh-cookie';
import type { ApiEnv } from '../config/env';

function baseEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    NODE_ENV: 'development',
    PORT: 3001,
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: 9000,
    MINIO_ACCESS_KEY: 'x',
    MINIO_SECRET_KEY: 'x',
    MINIO_USE_SSL: false,
    ETA_BASE_URL: 'https://example.com',
    ETA_IDENTITY_BASE_URL: 'https://id.example.com',
    ETA_API_BASE_URL: 'https://api.example.com',
    ETA_SANDBOX_INTEGRATION: false,
    JWT_ACCESS_SECRET: 'test-access-secret-min-16',
    JWT_ACCESS_TTL: '15m',
    REFRESH_COOKIE_NAME: 'refresh_token',
    REFRESH_TTL_DAYS: 14,
    COOKIE_SECURE: true,
    COOKIE_SAMESITE: 'none',
    COOKIE_PARTITIONED: true,
    SECRETS_MASTER_KEY: Buffer.from('test-secrets-master-key-32bytes!').toString(
      'base64',
    ),
    ...overrides,
  };
}

describe('buildRefreshSerializeOptions', () => {
  it('sets HttpOnly Secure SameSite=None Path=/ Partitioned without Domain', () => {
    const opts = buildRefreshSerializeOptions(baseEnv({ COOKIE_DOMAIN: undefined }));
    expect(opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      partitioned: true,
    });
    expect(opts.domain).toBeUndefined();
  });

  it('omits Partitioned when COOKIE_PARTITIONED is false', () => {
    const opts = buildRefreshSerializeOptions(baseEnv({ COOKIE_PARTITIONED: false }));
    expect(opts.partitioned).toBeUndefined();
  });

  it('applies COOKIE_DOMAIN only when non-empty', () => {
    const opts = buildRefreshSerializeOptions(
      baseEnv({ COOKIE_DOMAIN: '.einvoice.example.com' }),
    );
    expect(opts.domain).toBe('.einvoice.example.com');
  });
});
