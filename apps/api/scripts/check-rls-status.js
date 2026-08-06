const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const roles = await p.$queryRawUnsafe(
    `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('einvoice_app','einvoice')`,
  );
  console.log('ROLES', JSON.stringify(roles, null, 2));

  const tables = await p.$queryRawUnsafe(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname`);
  console.log('TABLES', JSON.stringify(tables, null, 2));

  // Tables with tenant_id column but missing RLS or FORCE
  const gaps = await p.$queryRawUnsafe(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      ) AS has_tenant_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname`);
  const missing = gaps.filter(
    (t) =>
      t.has_tenant_id &&
      (!t.relrowsecurity || !t.relforcerowsecurity),
  );
  console.log('TENANT_TABLES_MISSING_RLS_OR_FORCE', JSON.stringify(missing, null, 2));

  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
