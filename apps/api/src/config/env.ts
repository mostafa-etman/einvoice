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
  /** Sandbox / preprod hosts (tenant activeEtaEnvironment = SANDBOX). */
  ETA_IDENTITY_BASE_URL: z.string().url().optional(),
  ETA_API_BASE_URL: z.string().url().optional(),
  /** Production hosts (tenant activeEtaEnvironment = PRODUCTION). */
  ETA_PRODUCTION_IDENTITY_BASE_URL: z.string().url().optional(),
  ETA_PRODUCTION_API_BASE_URL: z.string().url().optional(),
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
  /** Max tenant company logo upload size (PNG/JPEG/WebP/SVG). */
  TENANT_LOGO_MAX_BYTES: z.coerce.number().int().positive().default(1_048_576),
  EXPORT_ARTIFACT_TTL_DAYS: z.coerce.number().int().positive().default(14),
  PACKAGE_POLL_INITIAL_MS: z.coerce.number().int().positive().default(5000),
  PACKAGE_POLL_MAX_MS: z.coerce.number().int().positive().default(120_000),
  PACKAGE_STALL_HOURS: z.coerce.number().int().positive().default(24),
  SYNC_BACKOFF_INITIAL_MS: z.coerce.number().int().positive().default(1000),
  SYNC_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(60_000),
  /** Delay between sequential ETA calls during sales/purchases sync (ms). */
  ETA_SYNC_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  USAGE_METERING_TIMEZONE: z.string().default('Africa/Cairo'),
  USAGE_EXPORT_TTL_DAYS: z.coerce.number().int().positive().default(14),
  USAGE_ROLLUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  BACKUP_ARCHIVE_MASTER_KEY: z.string().optional(),
  BACKUP_ARTIFACT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BACKUP_SCHEDULE_TICK_MS: z.coerce.number().int().positive().default(60_000),
  BACKUP_RETENTION_KEEP_LAST: z.coerce.number().int().positive().default(14),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
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
  /**
   * Process role for production split:
   * - all (default): HTTP + in-process crons/schedulers (local/dev)
   * - api: HTTP only; skip in-process crons (worker owns them)
   * - worker: process queues + crons; still listens for healthchecks
   */
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  // SaaS layer (013): billing / platform-admin / email.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_PROVIDER: z.enum(['stripe', 'local']).default('stripe'),
  BILLING_GRACE_DAYS: z.coerce.number().int().positive().default(3),
  BILLING_PAST_DUE_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  IMPERSONATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  EMAIL_TRANSPORT: z.string().default('console'),
});

export type ApiEnv = Omit<
  z.infer<typeof envSchema>,
  | 'SECRETS_MASTER_KEY'
  | 'BACKUP_ARCHIVE_MASTER_KEY'
  | 'ETA_IDENTITY_BASE_URL'
  | 'ETA_API_BASE_URL'
  | 'ETA_PRODUCTION_IDENTITY_BASE_URL'
  | 'ETA_PRODUCTION_API_BASE_URL'
  | 'ETA_SANDBOX_INTEGRATION'
  | 'PURCHASES_SYNC_ENABLED'
  | 'PURCHASES_SYNC_USE_RECENT'
> & {
  SECRETS_MASTER_KEY: string;
  BACKUP_ARCHIVE_MASTER_KEY: string;
  ETA_IDENTITY_BASE_URL: string;
  ETA_API_BASE_URL: string;
  ETA_PRODUCTION_IDENTITY_BASE_URL: string;
  ETA_PRODUCTION_API_BASE_URL: string;
  ETA_SANDBOX_INTEGRATION: boolean;
  PURCHASES_SYNC_ENABLED: boolean;
  PURCHASES_SYNC_USE_RECENT: boolean;
};

const TEST_SECRETS_MASTER_KEY = Buffer.from(
  'test-secrets-master-key-32bytes!',
).toString('base64');
const TEST_BACKUP_ARCHIVE_MASTER_KEY = Buffer.from(
  'test-backup-archive-key-32bytes!',
).toString('base64');

function assertMasterKey32(
  raw: string | undefined,
  nodeEnv: ApiEnv['NODE_ENV'],
  envName: string,
  testDefault: string,
): string {
  const value = raw?.trim() || (nodeEnv === 'test' ? testDefault : undefined);
  if (!value) {
    throw new Error(
      `Invalid environment configuration: ${envName}: required (base64 32-byte key)`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error(
      `Invalid environment configuration: ${envName}: must be valid base64`,
    );
  }
  if (key.length !== 32) {
    throw new Error(
      `Invalid environment configuration: ${envName}: must decode to exactly 32 bytes`,
    );
  }
  return value;
}

function assertSecretsMasterKey(
  raw: string | undefined,
  nodeEnv: ApiEnv['NODE_ENV'],
): string {
  return assertMasterKey32(raw, nodeEnv, 'SECRETS_MASTER_KEY', TEST_SECRETS_MASTER_KEY);
}

const DEFAULT_PRODUCTION_IDENTITY = 'https://id.eta.gov.eg';
const DEFAULT_PRODUCTION_API = 'https://api.invoicing.eta.gov.eg';

function resolveEtaUrls(data: z.infer<typeof envSchema>): {
  ETA_IDENTITY_BASE_URL: string;
  ETA_API_BASE_URL: string;
  ETA_PRODUCTION_IDENTITY_BASE_URL: string;
  ETA_PRODUCTION_API_BASE_URL: string;
} {
  const identity = data.ETA_IDENTITY_BASE_URL?.trim();
  const api = data.ETA_API_BASE_URL?.trim();
  const prodIdentity =
    data.ETA_PRODUCTION_IDENTITY_BASE_URL?.trim() || DEFAULT_PRODUCTION_IDENTITY;
  const prodApi =
    data.ETA_PRODUCTION_API_BASE_URL?.trim() || DEFAULT_PRODUCTION_API;

  let sandbox: { ETA_IDENTITY_BASE_URL: string; ETA_API_BASE_URL: string };
  if (identity && api) {
    sandbox = { ETA_IDENTITY_BASE_URL: identity, ETA_API_BASE_URL: api };
  } else if (data.NODE_ENV === 'test') {
    sandbox = {
      ETA_IDENTITY_BASE_URL: identity || DEFAULT_IDENTITY,
      ETA_API_BASE_URL: api || data.ETA_BASE_URL || DEFAULT_API,
    };
  } else if (!identity || !api) {
    throw new Error(
      'Invalid environment configuration: ETA_IDENTITY_BASE_URL and ETA_API_BASE_URL are both required (do not rely on legacy ETA_BASE_URL alone)',
    );
  } else {
    sandbox = { ETA_IDENTITY_BASE_URL: identity, ETA_API_BASE_URL: api };
  }

  return {
    ...sandbox,
    ETA_PRODUCTION_IDENTITY_BASE_URL: prodIdentity,
    ETA_PRODUCTION_API_BASE_URL: prodApi,
  };
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
  const BACKUP_ARCHIVE_MASTER_KEY = assertMasterKey32(
    result.data.BACKUP_ARCHIVE_MASTER_KEY,
    result.data.NODE_ENV,
    'BACKUP_ARCHIVE_MASTER_KEY',
    TEST_BACKUP_ARCHIVE_MASTER_KEY,
  );
  const urls = resolveEtaUrls(result.data);
  return {
    ...result.data,
    ...urls,
    SECRETS_MASTER_KEY,
    BACKUP_ARCHIVE_MASTER_KEY,
    ETA_SANDBOX_INTEGRATION: result.data.ETA_SANDBOX_INTEGRATION ?? false,
    PURCHASES_SYNC_ENABLED: result.data.PURCHASES_SYNC_ENABLED ?? false,
    PURCHASES_SYNC_USE_RECENT: result.data.PURCHASES_SYNC_USE_RECENT ?? true,
    PURCHASES_SYNC_INTERVAL_MS: result.data.PURCHASES_SYNC_INTERVAL_MS ?? 900_000,
    COOKIE_SECURE: result.data.COOKIE_SECURE ?? false,
    COOKIE_PARTITIONED: result.data.COOKIE_PARTITIONED ?? false,
  };
}

export function shouldRunInProcessCrons(env: ApiEnv = loadEnv()): boolean {
  return env.APP_ROLE === 'all' || env.APP_ROLE === 'worker';
}

export function getCorsOrigins(env: ApiEnv): string[] | true {
  if (!env.CORS_ORIGINS) {
    return true;
  }
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
