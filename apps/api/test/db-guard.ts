import { PrismaClient } from '@prisma/client';

/**
 * Some local dev setups don't have Postgres running. These integration
 * suites boot the full Nest app (real DB), so we probe once and let tests
 * no-op gracefully instead of failing on an unrelated connectivity error.
 * CI always provisions Postgres (see .github/workflows/ci.yml) so the real
 * assertions still run there.
 */
let cached: Promise<boolean> | null = null;

export function isDatabaseAvailable(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      const client = new PrismaClient();
      try {
        await Promise.race([
          client.$queryRaw`SELECT 1`,
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('db probe timeout')), 3000),
          ),
        ]);
        return true;
      } catch {
        return false;
      } finally {
        await client.$disconnect().catch(() => undefined);
      }
    })();
  }
  return cached;
}

export function skipMessage(suite: string): void {
  console.warn(`[${suite}] Skipping: no database connection available in this environment.`);
}
