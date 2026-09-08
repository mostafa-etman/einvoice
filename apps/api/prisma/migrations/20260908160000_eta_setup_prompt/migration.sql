-- First-login ETA setup prompt + configurable tutorial video URL.
-- Existing tenants keep their current login destination (dashboard).
-- New tenants (dismissed_at NULL, no ETA creds) are prompted until they
-- connect or click "don't show again".

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "eta_setup_prompt_dismissed_at" TIMESTAMPTZ;

UPDATE "tenants"
SET "eta_setup_prompt_dismissed_at" = COALESCE("eta_setup_prompt_dismissed_at", now())
WHERE "eta_setup_prompt_dismissed_at" IS NULL;

ALTER TABLE "platform_settings"
  ADD COLUMN IF NOT EXISTS "eta_tutorial_video_url" TEXT;
