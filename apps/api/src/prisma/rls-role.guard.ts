import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fail closed if the runtime DB role can bypass RLS.
 * Connecting as `einvoice` (superuser / BYPASSRLS) would silently return
 * every tenant's branches, memberships, and item codes.
 */
@Injectable()
export class RlsRoleGuard implements OnModuleInit {
  private readonly logger = new Logger(RlsRoleGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>
      >`
        SELECT current_user::text AS current_user,
               r.rolsuper,
               r.rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
      `;
      const row = rows[0];
      if (!row) {
        throw new Error('Could not resolve current DB role');
      }
      if (row.rolbypassrls || row.rolsuper) {
        throw new Error(
          `Unsafe database role "${row.current_user}" ` +
            `(rolsuper=${row.rolsuper}, rolbypassrls=${row.rolbypassrls}). ` +
            `DATABASE_URL must use einvoice_app (NOBYPASSRLS), not einvoice.`,
        );
      }
      this.logger.log(`RLS runtime role ok: ${row.current_user}`);
    } catch (err) {
      // Do not soft-fail: isolation depends on this.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }
}
