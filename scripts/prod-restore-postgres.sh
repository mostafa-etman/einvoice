#!/usr/bin/env bash
# Restore Postgres from a gzipped SQL dump produced by prod-backup.sh
# Usage: ./scripts/prod-restore-postgres.sh backups/20260806T120000Z/postgres.sql.gz
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DUMP="${1:?path to postgres.sql.gz required}"

echo "WARNING: This replaces the current database contents."
gunzip -c "$DUMP" | docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "Postgres restore finished. Re-run ./scripts/prod-migrate.sh if needed."
