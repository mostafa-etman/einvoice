import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgresql://einvoice:einvoice@localhost:5432/einvoice?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: '9000',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_USE_SSL: 'false',
    ETA_IDENTITY_BASE_URL: 'https://id.preprod.eta.gov.eg',
    ETA_API_BASE_URL: 'https://api.preprod.invoicing.eta.gov.eg',
    JWT_ACCESS_SECRET: 'test-access-secret-min-16',
    SECRETS_MASTER_KEY: Buffer.from(
      'test-secrets-master-key-32bytes!',
    ).toString('base64'),
    BACKUP_ARCHIVE_MASTER_KEY: Buffer.from(
      'test-backup-archive-key-32bytes!',
    ).toString('base64'),
  };

  it('loads valid configuration', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.MINIO_USE_SSL).toBe(false);
    expect(env.ETA_IDENTITY_BASE_URL).toBe('https://id.preprod.eta.gov.eg');
    expect(env.ETA_API_BASE_URL).toBe(
      'https://api.preprod.invoicing.eta.gov.eg',
    );
    expect(env.ETA_PRODUCTION_IDENTITY_BASE_URL).toBe('https://id.eta.gov.eg');
    expect(env.ETA_PRODUCTION_API_BASE_URL).toBe(
      'https://api.invoicing.eta.gov.eg',
    );
  });

  it('fails fast naming missing required keys', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/i);
  });

  it('uses test default SECRETS_MASTER_KEY when NODE_ENV=test', () => {
    const env = loadEnv({ ...valid, NODE_ENV: 'test' });
    expect(Buffer.from(env.SECRETS_MASTER_KEY, 'base64').length).toBe(32);
  });

  it('fails fast when SECRETS_MASTER_KEY missing outside test', () => {
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: 'production', SECRETS_MASTER_KEY: undefined }),
    ).toThrow(/SECRETS_MASTER_KEY/i);
  });

  it('fails closed outside test when ETA identity/API URLs missing', () => {
    const { ETA_IDENTITY_BASE_URL: _i, ETA_API_BASE_URL: _a, ...rest } = valid;
    expect(() =>
      loadEnv({ ...rest, NODE_ENV: 'production', SECRETS_MASTER_KEY: valid.JWT_ACCESS_SECRET && Buffer.from('test-secrets-master-key-32bytes!').toString('base64') }),
    ).toThrow(/ETA_IDENTITY_BASE_URL|ETA_API_BASE_URL/i);
  });

  it('does not invent identity from legacy ETA_BASE_URL alone outside test', () => {
    const { ETA_IDENTITY_BASE_URL: _i, ETA_API_BASE_URL: _a, ...rest } = valid;
    expect(() =>
      loadEnv({
        ...rest,
        NODE_ENV: 'development',
        ETA_BASE_URL: 'https://api.preprod.invoicing.eta.gov.eg',
        SECRETS_MASTER_KEY: Buffer.from(
          'test-secrets-master-key-32bytes!',
        ).toString('base64'),
      }),
    ).toThrow(/ETA_IDENTITY_BASE_URL|ETA_API_BASE_URL/i);
  });

  it('defaults sandbox/preprod hosts in test when URLs omitted', () => {
    const { ETA_IDENTITY_BASE_URL: _i, ETA_API_BASE_URL: _a, ...rest } = valid;
    const env = loadEnv({ ...rest, NODE_ENV: 'test' });
    expect(env.ETA_IDENTITY_BASE_URL).toContain('preprod');
    expect(env.ETA_API_BASE_URL).toContain('preprod');
  });
});
