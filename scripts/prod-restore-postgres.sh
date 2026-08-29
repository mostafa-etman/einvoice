#!/usr/bin/env bash
# Restore Postgres from a gzipped SQL dump produced by prod-backup.sh / prod-deploy.sh
# WARNING: replaces current database contents. Does not delete MinIO files.
#
# Usage:
#   ./scripts/prod-restore-postgres.sh backups/daily/20260829T020000Z/postgres.sql.gz
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

DUMP="${1:?path to postgres.sql.gz required}"
if [[ ! -f "$DUMP" ]]; then
  echo "Dump not found: $DUMP" >&2
  exit 1
fi

einvoice_require_env_prod
echo "WARNING: This REPLACES the current Postgres database."
echo "Dump: $DUMP"
read -r -p "Type yes to continue: " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

echo "Stopping writers (api/worker/web)..."
einvoice_compose stop api worker web

echo "Restoring..."
gunzip -c "$DUMP" | einvoice_compose exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'

echo "Postgres restore finished. Applying migrate deploy (owner role) in case dump is slightly behind code..."
"$ROOT/scripts/prod-migrate.sh"

einvoice_compose up -d api worker web
echo "Restore complete. Check: docker compose -f docker-compose.prod.yml --env-file .env.prod ps"
