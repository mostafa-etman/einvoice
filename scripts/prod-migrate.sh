#!/usr/bin/env bash
# Apply Prisma migrations using MIGRATE_DATABASE_URL (Postgres owner / einvoice).
# Runtime DATABASE_URL (einvoice_app) must NEVER run migrate — it has no DDL.
#
# Usage (on VPS, from repo root):
#   ./scripts/prod-migrate.sh
#
# Exact command this script runs (after building the api image so new
# prisma/migrations are inside it):
#   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps \
#     api node ./scripts/migrate.mjs
#
# migrate.mjs sets DATABASE_URL=$MIGRATE_DATABASE_URL then:
#   npx prisma migrate deploy
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

einvoice_require_env_prod
einvoice_assert_admin_migrate_url
einvoice_wait_postgres

echo "Building api image (migrations live in the image, not a bind mount)..."
einvoice_compose build api

echo "Applying prisma migrate deploy as MIGRATE_DATABASE_URL (owner role)..."
einvoice_compose run --rm --no-deps api node ./scripts/migrate.mjs

echo "Migrations applied with MIGRATE_DATABASE_URL (einvoice owner role)."
