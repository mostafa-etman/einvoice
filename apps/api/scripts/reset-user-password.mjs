/**
 * Reset a single user's password (argon2id, same params as PasswordService).
 * Does not create users, tenants, or touch documents/points.
 *
 * Env:
 *   RESET_USER_EMAIL
 *   RESET_USER_PASSWORD
 *   MIGRATE_DATABASE_URL (preferred) or DATABASE_URL
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const email = (process.env.RESET_USER_EMAIL ?? '').trim().toLowerCase();
const password = process.env.RESET_USER_PASSWORD ?? '';

if (!email || !email.includes('@')) {
  console.error('RESET_USER_EMAIL is required.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('RESET_USER_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

if (process.env.MIGRATE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash(password, {
    algorithm: 2, // argon2id — must match PasswordService
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  const revoked = await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
  console.log(`Password updated for ${email} (${revoked.count} refresh session(s) revoked).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
