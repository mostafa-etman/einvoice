const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function withTenant(tenantId, fn) {
  return p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', $1, true)`,
      tenantId,
    );
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '', true)`);
    return fn(tx);
  });
}

(async () => {
  const suffix = Date.now();
  // Find two existing tenants or create via raw
  const tenants = await p.tenant.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log(
    'recent tenants',
    tenants.map((t) => ({ id: t.id, name: t.name })),
  );

  if (tenants.length < 2) {
    console.log('Need at least 2 tenants in DB to compare; aborting');
    await p.$disconnect();
    return;
  }

  const [a, b] = tenants;
  const branchesA = await withTenant(a.id, (tx) => tx.branch.findMany());
  const branchesB = await withTenant(b.id, (tx) => tx.branch.findMany());
  const itemsA = await withTenant(a.id, (tx) => tx.itemCode.findMany());
  const itemsB = await withTenant(b.id, (tx) => tx.itemCode.findMany());
  const membersA = await withTenant(a.id, (tx) =>
    tx.membership.findMany({ include: { user: true } }),
  );
  const membersB = await withTenant(b.id, (tx) =>
    tx.membership.findMany({ include: { user: true } }),
  );

  // Unscoped (should see all if RLS not applied — table owner vs app role)
  const unscopedBranches = await p.branch.findMany({ take: 50 });
  const unscopedItems = await p.itemCode.findMany({ take: 50 });
  const unscopedMembers = await p.membership.findMany({ take: 50 });

  console.log(
    JSON.stringify(
      {
        whoami: await p.$queryRawUnsafe(`SELECT current_user, session_user`),
        tenantA: a.name,
        tenantB: b.name,
        branchesA: branchesA.map((x) => x.tenantId),
        branchesB: branchesB.map((x) => x.tenantId),
        leakA_hasB_branches: branchesA.some((x) => x.tenantId === b.id),
        leakB_hasA_branches: branchesB.some((x) => x.tenantId === a.id),
        itemsA_tenants: [...new Set(itemsA.map((x) => x.tenantId))],
        itemsB_tenants: [...new Set(itemsB.map((x) => x.tenantId))],
        leakA_hasB_items: itemsA.some((x) => x.tenantId === b.id),
        membersA_emails: membersA.map((m) => m.user.email),
        membersB_emails: membersB.map((m) => m.user.email),
        leakA_hasB_member: membersA.some((m) => m.tenantId === b.id),
        unscopedBranchTenants: [...new Set(unscopedBranches.map((x) => x.tenantId))],
        unscopedItemTenants: [...new Set(unscopedItems.map((x) => x.tenantId))],
        unscopedMemberTenants: [...new Set(unscopedMembers.map((x) => x.tenantId))],
        unscopedBranchCount: unscopedBranches.length,
        unscopedItemCount: unscopedItems.length,
        unscopedMemberCount: unscopedMembers.length,
      },
      null,
      2,
    ),
  );

  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
