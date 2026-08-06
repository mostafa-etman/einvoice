-- Issuer (seller) address lives in branch settings; documents inherit it.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "address_country" TEXT,
  ADD COLUMN IF NOT EXISTS "address_governate" TEXT,
  ADD COLUMN IF NOT EXISTS "address_region_city" TEXT,
  ADD COLUMN IF NOT EXISTS "address_street" TEXT,
  ADD COLUMN IF NOT EXISTS "address_building_number" TEXT,
  ADD COLUMN IF NOT EXISTS "address_postal_code" TEXT,
  ADD COLUMN IF NOT EXISTS "address_floor" TEXT,
  ADD COLUMN IF NOT EXISTS "address_room" TEXT,
  ADD COLUMN IF NOT EXISTS "address_landmark" TEXT,
  ADD COLUMN IF NOT EXISTS "address_additional_information" TEXT;

-- Backfill the issuer address from the most recent document issued by the branch
-- so existing tenants keep the address they already typed on invoices.
UPDATE "branches" b
SET
  "address_country" = COALESCE(b."address_country", NULLIF(a."country", '')),
  "address_governate" = COALESCE(b."address_governate", NULLIF(a."governate", '')),
  "address_region_city" = COALESCE(b."address_region_city", NULLIF(a."region_city", '')),
  "address_street" = COALESCE(b."address_street", NULLIF(a."street", '')),
  "address_building_number" = COALESCE(
    b."address_building_number",
    NULLIF(a."building_number", '')
  ),
  "address_postal_code" = COALESCE(b."address_postal_code", NULLIF(a."postal_code", '')),
  "address_floor" = COALESCE(b."address_floor", NULLIF(a."floor", '')),
  "address_room" = COALESCE(b."address_room", NULLIF(a."room", '')),
  "address_landmark" = COALESCE(b."address_landmark", NULLIF(a."landmark", ''))
FROM (
  SELECT DISTINCT ON (d."branch_id")
    d."branch_id",
    d."issuer_snapshot_json" -> 'address' ->> 'country' AS "country",
    d."issuer_snapshot_json" -> 'address' ->> 'governate' AS "governate",
    d."issuer_snapshot_json" -> 'address' ->> 'regionCity' AS "region_city",
    d."issuer_snapshot_json" -> 'address' ->> 'street' AS "street",
    d."issuer_snapshot_json" -> 'address' ->> 'buildingNumber' AS "building_number",
    d."issuer_snapshot_json" -> 'address' ->> 'postalCode' AS "postal_code",
    d."issuer_snapshot_json" -> 'address' ->> 'floor' AS "floor",
    d."issuer_snapshot_json" -> 'address' ->> 'room' AS "room",
    d."issuer_snapshot_json" -> 'address' ->> 'landmark' AS "landmark"
  FROM "documents" d
  WHERE d."issuer_snapshot_json" -> 'address' ->> 'governate' IS NOT NULL
    AND d."issuer_snapshot_json" -> 'address' ->> 'governate' <> ''
  ORDER BY d."branch_id", d."updated_at" DESC
) a
WHERE a."branch_id" = b."id";
