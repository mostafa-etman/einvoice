import { z } from 'zod';

const DEFAULT_IDENTITY =
  'https://id.preprod.eta.gov.eg';
const DEFAULT_API =
  'https://api.preprod.invoicing.eta.gov.eg';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
  /** @deprecated Use ETA_IDENTITY_BASE_URL + ETA_API_BASE_URL */
  ETA_BASE_URL: z.string().url().optional(),
  ETA_IDENTITY_BASE_URL: z.string().url().optional(),
  ETA_API_BASE_URL: z.string().url().optional(),
  /** Not used for live tenant token calls — credentials come from DB (003). */
  ETA_CLIENT_ID: z.string().optional(),
  ETA_CLIENT_SECRET: z.string().optional(),
  ETA_SANDBOX_INTEGRATION: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  PURCHASES_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  PURCHASES_SYNC_USE_RECENT: z
    .string()
    .optional()
    .transform((v) => !(v === 'false' || v === '0')),
  PURCHASES_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(25_000_000),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(5000),
  EXPORT_ARTIFACT_TTL_DAYS: z.coerce.number().int().positive().default(14),
  PACKAGE_POLL_INITIAL_MS: z.coerce.number().int().positive().default(5000),
  PACKAGE_POLL_MAX_MS: z.coerce.number().int().positive().default(120_000),
  PACKAGE_STALL_HOURS: z.coerce.number().int().positive().default(24),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  COOKIE_PARTITIONED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  CORS_ORIGINS: z.string().optional(),
  SECRETS_MASTER_KEY: z.string().optional(),
});

export type ApiEnv = Omit<
  z.infer<typeof envSchema>,
  | 'SECRETS_MASTER_KEY'
  | 'ETA_IDENTITY_BASE_URL'
  | 'ETA_API_BASE_URL'
  | 'ETA_SANDBOX_INTEGRATION'
  | 'PURCHASES_SYNC_ENABLED'
  | 'PURCHASES_SYNC_USE_RECENT'
> & {
  SECRETS_MASTER_KEY: string;
  ETA_IDENTITY_BASE_URL: string;
  ETA_API_BASE_URL: string;
  ETA_SANDBOX_INTEGRATION: boolean;
  PURCHASES_SYNC_ENABLED: boolean;
  PURCHASES_SYNC_USE_RECENT: boolean;
};

const TEST_SECRETS_MASTER_KEY = Buffer.from(
  'test-secrets-master-key-32bytes!',
).toString('base64');

function assertSecretsMasterKey(
  raw: string | undefined,
  nodeEnv: ApiEnv['NODE_ENV'],
): string {
  const value = raw?.trim() || (nodeEnv === 'test' ? TEST_SECRETS_MASTER_KEY : undefined);
  if (!value) {
    throw new Error(
      'Invalid environment configuration: SECRETS_MASTER_KEY: required (base64 32-byte key)',
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error(
      'Invalid environment configuration: SECRETS_MASTER_KEY: must be valid base64',
    );
  }
  if (key.length !== 32) {
    throw new Error(
      'Invalid environment configuration: SECRETS_MASTER_KEY: must decode to exactly 32 bytes',
    );
  }
  return value;
}

function resolveEtaUrls(data: z.infer<typeof envSchema>): {
  ETA_IDENTITY_BASE_URL: string;
  ETA_API_BASE_URL: string;
} {
  const identity = data.ETA_IDENTITY_BASE_URL?.trim();
  const api = data.ETA_API_BASE_URL?.trim();
  if (identity && api) {
    return { ETA_IDENTITY_BASE_URL: identity, ETA_API_BASE_URL: api };
  }
  // Fail closed: do not invent identity from legacy ETA_BASE_URL alone.
  if (data.NODE_ENV === 'test') {
    return {
      ETA_IDENTITY_BASE_URL: identity || DEFAULT_IDENTITY,
      ETA_API_BASE_URL: api || data.ETA_BASE_URL || DEFAULT_API,
    };
  }
  if (!identity || !api) {
    throw new Error(
      'Invalid environment configuration: ETA_IDENTITY_BASE_URL and ETA_API_BASE_URL are both required (do not rely on legacy ETA_BASE_URL alone)',
    );
  }
  return { ETA_IDENTITY_BASE_URL: identity, ETA_API_BASE_URL: api };
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  const SECRETS_MASTER_KEY = assertSecretsMasterKey(
    result.data.SECRETS_MASTER_KEY,
    result.data.NODE_ENV,
  );
  const urls = resolveEtaUrls(result.data);
  return {
    ...result.data,
    ...urls,
    SECRETS_MASTER_KEY,
    ETA_SANDBOX_INTEGRATION: result.data.ETA_SANDBOX_INTEGRATION ?? false,
    PURCHASES_SYNC_ENABLED: result.data.PURCHASES_SYNC_ENABLED ?? false,
    PURCHASES_SYNC_USE_RECENT: result.data.PURCHASES_SYNC_USE_RECENT ?? true,
    PURCHASES_SYNC_INTERVAL_MS: result.data.PURCHASES_SYNC_INTERVAL_MS ?? 900_000,
    COOKIE_SECURE: result.data.COOKIE_SECURE ?? false,
    COOKIE_PARTITIONED: result.data.COOKIE_PARTITIONED ?? false,
  };
}

export function getCorsOrigins(env: ApiEnv): string[] | true {
  if (!env.CORS_ORIGINS) {
    return true;
  }
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
