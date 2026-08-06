-- Fix sync_conflicts enums to match Prisma schema

CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "SyncConflictResolution" AS ENUM ('KEEP_LOCAL', 'KEEP_SERVER', 'MERGED');

ALTER TABLE "sync_conflicts"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "sync_conflicts"
  ALTER COLUMN "status" TYPE "SyncConflictStatus"
  USING ("status"::"SyncConflictStatus");

ALTER TABLE "sync_conflicts"
  ALTER COLUMN "status" SET DEFAULT 'OPEN'::"SyncConflictStatus";

ALTER TABLE "sync_conflicts"
  ALTER COLUMN "resolution" TYPE "SyncConflictResolution"
  USING (
    CASE
      WHEN "resolution" IS NULL THEN NULL
      ELSE "resolution"::"SyncConflictResolution"
    END
  );
