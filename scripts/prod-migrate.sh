#!/usr/bin/env bash
# Apply Prisma migrations using MIGRATE_DATABASE_URL (admin/owner role).
# Runtime DATABASE_URL (einvoice_app) must NOT own tables.
#
# Usage (on VPS, from repo root):
#   ./scripts/prod-migrate.sh
#
# Equivalent one-liner:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
#     node ./scripts/migrate.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.prod ]]; then
  echo "Missing .env.prod — copy from .env.prod.example and fill secrets." >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node ./scripts/migrate.mjs

echo "Migrations applied with MIGRATE_DATABASE_URL."
