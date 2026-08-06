-- Taxpayer legal name + issuer type live on the tenant (company identity).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "legal_name" TEXT,
  ADD COLUMN IF NOT EXISTS "issuer_type" TEXT NOT NULL DEFAULT 'B';

-- Backfill legal_name from the most recent document issuer.name that is NOT
-- just the branch label (e.g. "Main"). Never invent a name.
UPDATE "tenants" t
SET "legal_name" = COALESCE(t."legal_name", NULLIF(src."issuer_name", ''))
FROM (
  SELECT DISTINCT ON (d."tenant_id")
    d."tenant_id",
    d."issuer_snapshot_json" ->> 'name' AS "issuer_name"
  FROM "documents" d
  INNER JOIN "branches" b ON b."id" = d."branch_id"
  WHERE NULLIF(TRIM(d."issuer_snapshot_json" ->> 'name'), '') IS NOT NULL
    AND LOWER(TRIM(d."issuer_snapshot_json" ->> 'name'))
      <> LOWER(TRIM(b."name"))
  ORDER BY d."tenant_id", d."updated_at" DESC
) src
WHERE src."tenant_id" = t."id"
  AND t."legal_name" IS NULL;
