/**
 * Idempotent local dev seed: tenant + Owner user + default branch + default roles.
 *
 * Runs as the app runtime role (DATABASE_URL), so every write to an RLS-forced
 * table happens inside a transaction that sets app.tenant_id, exactly like
 * TenantPrismaService.withTenant does at runtime.
 *
 * Password is hashed with the same argon2id parameters as PasswordService so
 * POST /auth/login verifies the seeded credential.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_ROLE_NAMES,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
} from '@einvoice/shared';
import { seedEtaCodeTables } from './seed-eta-codes.mjs';

const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Test Company';
const BRANCH_NAME = process.env.SEED_BRANCH_NAME ?? 'Main';
const EMAIL = (process.env.SEED_OWNER_EMAIL ?? 'owner@test.local').trim().toLowerCase();
const PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Password123!';
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'Test Owner';

const prisma = new PrismaClient();

// Mirrors apps/api/src/auth/password.service.ts
function hashPassword(password) {
  return hash(password, {
    algorithm: 2, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function ensurePermissionCatalog() {
  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }
  const permissions = await prisma.permission.findMany();
  return new Map(permissions.map((p) => [p.code, p.id]));
}

async function ensureUser() {
  const passwordHash = await hashPassword(PASSWORD);
  return prisma.user.upsert({
    where: { email: EMAIL },
    // Re-running resets the known dev password so the documented credential always works.
    update: { passwordHash, name: OWNER_NAME },
    create: { email: EMAIL, passwordHash, name: OWNER_NAME },
  });
}

async function ensureTenant() {
  const existing = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } });
  if (existing) return { tenant: existing, created: false };
  const tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });
  return { tenant, created: true };
}

async function ensureTenantScopedRecords(tenantId, userId, permissionIdByCode) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    let branch = await tx.branch.findFirst({ where: { tenantId, name: BRANCH_NAME } });
    if (!branch) {
      branch = await tx.branch.create({
        data: { tenantId, name: BRANCH_NAME, isDefault: true },
      });
    }

    const roleIdByName = {};
    for (const roleName of DEFAULT_ROLE_NAMES) {
      const role = await tx.role.upsert({
        where: { tenantId_name: { tenantId, name: roleName } },
        update: {},
        create: { tenantId, name: roleName, isSystem: true },
      });
      roleIdByName[roleName] = role.id;

      for (const code of ROLE_PERMISSION_MATRIX[roleName]) {
        const permissionId = permissionIdByCode.get(code);
        if (!permissionId) continue;
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          update: {},
          create: { tenantId, roleId: role.id, permissionId },
        });
      }
    }

    const membership = await tx.membership.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      update: { roleId: roleIdByName.Owner },
      create: { tenantId, userId, roleId: roleIdByName.Owner },
    });

    return { branch, roleIdByName, membership };
  });
}

async function main() {
  const permissionIdByCode = await ensurePermissionCatalog();
  const user = await ensureUser();
  const { tenant, created } = await ensureTenant();
  const { branch, roleIdByName } = await ensureTenantScopedRecords(
    tenant.id,
    user.id,
    permissionIdByCode,
  );

  console.log('Seed complete (idempotent):');
  console.log(`  tenant   : ${tenant.name} (${tenant.id})${created ? ' [created]' : ' [existing]'}`);
  console.log(`  branch   : ${branch.name} (${branch.id}) isDefault=${branch.isDefault}`);
  console.log(`  roles    : ${Object.keys(roleIdByName).join(', ')}`);
  console.log(`  owner    : ${user.email} (${user.id})`);
  console.log(`  password : ${PASSWORD}`);

  console.log('\nSeeding ETA static code tables (offline SDK JSON)…');
  const catalogs = await seedEtaCodeTables();
  for (const c of catalogs) {
    console.log(`  ${c.kind.padEnd(18)} ${String(c.entryCount).padStart(4)}`);
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
