const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'import%' OR tablename LIKE 'export%' OR tablename LIKE 'eta_package%')",
)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await p.$disconnect();
    process.exit(1);
  });
