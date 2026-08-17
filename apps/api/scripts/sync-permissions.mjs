/**
 * Idempotent, NON-DESTRUCTIVE permission catalog + system-role matrix sync.
 *
 * Safe on production:
 *   - INSERT / upsert only (ON CONFLICT / skipDuplicates)
 *   - Never DELETE users, documents, tenants, memberships, or role_permissions
 *   - Never revokes permissions an owner already granted
 *
 * Uses MIGRATE_DATABASE_URL when set (DB owner / BYPASSRLS) so RLS-forced
 * `roles` and `role_permissions` are visible across tenants. Falls back to
 * DATABASE_URL and SET LOCAL app.tenant_id per tenant (einvoice_app).
 *
 * Production:
 *   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
 *     node ./scripts/sync-permissions.mjs
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  DEFAULT_ROLE_NAMES,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
} from '@einvoice/shared';

if (process.env.MIGRATE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
}

const prisma = new PrismaClient();

async function ensurePermissionCatalog() {
  let created = 0;
  for (const code of Object.values(PERMISSIONS)) {
    const row = await prisma.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
    if (row.code === code) {
      created += 1;
    }
  }
  const permissions = await prisma.permission.findMany();
  return {
    byCode: new Map(permissions.map((p) => [p.code, p.id])),
    catalogSize: permissions.length,
    upserted: created,
  };
}

async function grantMissing(tenantId, byCode) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const roles = await tx.role.findMany({
      where: { tenantId, isSystem: true, name: { in: [...DEFAULT_ROLE_NAMES] } },
      select: { id: true, name: true },
    });
    const rows = [];
    for (const role of roles) {
      const matrix =
        role.name === 'Owner'
          ? ALL_PERMISSION_CODES
          : ROLE_PERMISSION_MATRIX[role.name];
      if (!matrix) continue;
      for (const code of matrix) {
        const permissionId = byCode.get(code);
        if (!permissionId) continue;
        rows.push({ tenantId, roleId: role.id, permissionId });
      }
    }
    if (!rows.length) return 0;
    const result = await tx.rolePermission.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  });
}

async function main() {
  const { byCode, catalogSize } = await ensurePermissionCatalog();
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  let granted = 0;
  for (const tenant of tenants) {
    granted += await grantMissing(tenant.id, byCode);
  }

  console.log('Permission sync complete (non-destructive):');
  console.log(`  catalog codes : ${catalogSize}`);
  console.log(`  tenants       : ${tenants.length}`);
  console.log(`  rows granted  : ${granted} (duplicates skipped)`);
  console.log('  no deletes    : users / documents / tenants / memberships untouched');
}

main()
  .catch((error) => {
    console.error('Permission sync failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
