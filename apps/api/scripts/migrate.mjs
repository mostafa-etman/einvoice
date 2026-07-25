import { spawnSync } from 'node:child_process';

process.env.DATABASE_URL =
  process.env.MIGRATE_DATABASE_URL ||
  'postgresql://einvoice:einvoice@localhost:5432/einvoice?schema=public';

const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
