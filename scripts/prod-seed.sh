#!/usr/bin/env bash
# Idempotent seed (permission catalog + optional demo owner) using runtime DATABASE_URL.
# Run AFTER prod-migrate.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.prod ]]; then
  echo "Missing .env.prod" >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node ./scripts/seed.mjs

docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node ./scripts/seed-eta-codes.mjs

echo "Seed complete."
