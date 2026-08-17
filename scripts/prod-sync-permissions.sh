#!/usr/bin/env bash
# Idempotent, non-destructive permission catalog + system-role matrix sync.
# Uses MIGRATE_DATABASE_URL (owner / BYPASSRLS). Never deletes tenant data.
#
# Usage (on VPS, from repo root):
#   ./scripts/prod-sync-permissions.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.prod ]]; then
  echo "Missing .env.prod — copy from .env.prod.example and fill secrets." >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node ./scripts/sync-permissions.mjs

echo "Permission catalog + system-role grants synced (no deletes)."
