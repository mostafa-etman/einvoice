import { spawnSync } from 'node:child_process';

/**
 * Apply committed migrations only (`prisma migrate deploy`).
 * Never uses `migrate reset` / `db push --force-reset` — existing tenant data is preserved.
 *
 * Uses MIGRATE_DATABASE_URL (admin/owner role). Runtime app role must NOT own tables.
 */

function migrateDatabaseUrl() {
  const raw = process.env.MIGRATE_DATABASE_URL?.trim();
  if (raw) return raw;
  if (process.env.NODE_ENV === 'production') {
    return '';
  }
  return 'postgresql://einvoice:einvoice@localhost:5432/einvoice?schema=public';
}

const migrateUrl = migrateDatabaseUrl();
if (!migrateUrl) {
  console.error(
    'MIGRATE_DATABASE_URL is required in production (Postgres owner role, not einvoice_app).',
  );
  process.exit(1);
}
if (/\/\/einvoice_app[:@]/i.test(migrateUrl)) {
  console.error(
    'Refusing to migrate as einvoice_app (no schema DDL / permission-denied). Set MIGRATE_DATABASE_URL to the einvoice owner role.',
  );
  process.exit(1);
}

process.env.DATABASE_URL = migrateUrl;

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
