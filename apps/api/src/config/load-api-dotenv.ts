import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load apps/api/.env into process.env without overriding keys already set
 * (CI / shell wins). Ensures nest start picks up DATABASE_URL=einvoice_app
 * even when no dotenv package is wired in.
 */
export function loadApiDotEnv(cwd = process.cwd()): void {
  const candidates = [
    resolve(cwd, '.env'),
    resolve(cwd, 'apps/api/.env'),
    resolve(__dirname, '../../.env'),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return;

  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
