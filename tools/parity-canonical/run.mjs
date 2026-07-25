#!/usr/bin/env node
/**
 * CLI wrapper for T010a — delegates to Jest parity-agent.spec.ts
 * (agent === etaCore === expected on locked vectors only).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const r = spawnSync(
  'pnpm',
  ['--filter', '@einvoice/eta-core', 'test', '--', '--runInBand', 'parity-agent'],
  { cwd: ROOT, encoding: 'utf8', shell: true, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
