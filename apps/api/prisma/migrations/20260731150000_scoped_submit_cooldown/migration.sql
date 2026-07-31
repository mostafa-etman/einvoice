-- Scope the ETA duplicate cooldown to the exact payload it applies to, and make
-- the in-flight submit lock recoverable after a crash/restart.
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "submit_cooldown_payload_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "submit_in_flight_since" TIMESTAMP(3);

-- Any cooldown stored before this migration is unscoped; drop the ones that
-- already elapsed so they cannot linger and block new submissions.
UPDATE "documents"
   SET "submit_cooldown_until" = NULL,
       "submit_pending_retry_submission_id" = NULL
 WHERE "submit_cooldown_until" IS NOT NULL
   AND "submit_cooldown_until" <= now();

-- Release locks stranded by an earlier process restart.
UPDATE "documents"
   SET "submit_in_flight" = false
 WHERE "submit_in_flight" = true
   AND "submit_in_flight_since" IS NULL;
