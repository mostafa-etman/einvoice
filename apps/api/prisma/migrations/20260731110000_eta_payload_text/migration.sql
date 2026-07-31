-- Field order is part of the ETA signature: jsonb reorders object keys, which
-- changes the canonical string and breaks the CAdES message-digest (ITIDA 4043).
-- Store the exact ETA document bytes verbatim and sign/submit THOSE.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "eta_payload_text" TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO einvoice_app;
