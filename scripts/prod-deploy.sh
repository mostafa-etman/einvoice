#!/usr/bin/env bash
# One-command production deploy.
# Order:
#   1) timestamped pg_dump + MinIO backup (keep last N deploy snapshots)
#   2) git pull --ff-only
#   3) prisma migrate deploy as the ADMIN/owner role (MIGRATE_DATABASE_URL)
#   4) docker compose up -d --build --force-recreate web api worker
#   5) print container status + in-container health checks
#
# Usage (on the VPS, from the repo root):
#   ./scripts/prod-deploy.sh
#   ./scripts/prod-deploy.sh --dry-run
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

DRY_RUN=0
KEEP_DEPLOY="${BACKUP_KEEP_DEPLOY:-5}"
SKIP_GIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-git) SKIP_GIT=1; shift ;;
    --keep-deploy) KEEP_DEPLOY="${2:?}"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

step() { echo; echo "=== $* ==="; }

if [[ "$DRY_RUN" -eq 1 ]]; then
  step "dry-run plan"
  echo "1. $ROOT/scripts/prod-backup.sh --kind deploy --keep-deploy $KEEP_DEPLOY"
  echo "2. git pull --ff-only"
  echo "3. docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis minio"
  echo "4. docker compose ... build api"
  echo "5. docker compose ... run --rm --no-deps api node ./scripts/migrate.mjs"
  echo "     (migrate.mjs: DATABASE_URL=\$MIGRATE_DATABASE_URL → npx prisma migrate deploy)"
  echo "6. docker compose ... up -d --build --force-recreate web api worker"
  echo "7. docker compose ps + curl health/live inside api/worker/web"
  exit 0
fi

einvoice_require_env_prod
einvoice_assert_admin_migrate_url

step "1/5 Backup (Postgres + MinIO) before changing anything"
"$ROOT/scripts/prod-backup.sh" --kind deploy --keep-deploy "$KEEP_DEPLOY"

if [[ "$SKIP_GIT" -eq 0 ]]; then
  step "2/5 git pull --ff-only"
  git pull --ff-only
else
  echo "Skipping git pull (--skip-git)"
fi

step "3/5 Ensure infra is up, then migrate as owner role"
einvoice_compose up -d postgres redis minio
einvoice_wait_postgres
"$ROOT/scripts/prod-migrate.sh"

step "4/5 Recreate app containers from new images"
einvoice_compose up -d --build --force-recreate web api worker

step "5/5 Status + health"
einvoice_compose ps

echo
echo "In-container health:"
einvoice_compose exec -T api curl -fsS http://127.0.0.1:3001/health/live
echo
einvoice_compose exec -T worker curl -fsS http://127.0.0.1:3001/health/live
echo
einvoice_compose exec -T web curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:3000/ || true

echo
echo "Deploy finished. Public checks (optional):"
echo "  curl -fsS https://etaapi.erp-esafe.com/health/live"
echo "  curl -fsSI https://eta.erp-esafe.com | head"
