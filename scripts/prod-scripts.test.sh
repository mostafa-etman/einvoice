#!/usr/bin/env bash
# Logic tests for backup retention + deploy dry-run + bash syntax.
# Does not talk to production data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "bash -n on prod scripts..."
for s in \
  scripts/prod-common.sh \
  scripts/prod-backup.sh \
  scripts/prod-deploy.sh \
  scripts/prod-migrate.sh \
  scripts/prod-restore-postgres.sh \
  scripts/prod-restore-minio.sh \
  scripts/prod-install-backup-cron.sh \
  scripts/prod-reset-password.sh \
  scripts/prod-seed.sh \
  scripts/prod-sync-permissions.sh
do
  bash -n "$s" || fail "syntax $s"
done

echo "deploy --dry-run..."
DEPLOY_PLAN="$(bash "$ROOT/scripts/prod-deploy.sh" --dry-run)"
[[ "$DEPLOY_PLAN" == *"prisma migrate deploy"* ]] || fail "dry-run missing migrate deploy"
[[ "$DEPLOY_PLAN" == *"force-recreate web api worker"* ]] || fail "dry-run missing force-recreate"
BACKUP_PLAN="$(bash "$ROOT/scripts/prod-backup.sh" --dry-run --kind daily)"
[[ "$BACKUP_PLAN" == *"would pg_dump"* ]] || fail "backup dry-run missing pg_dump"

echo "retain keeps newest N dirs..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/daily/20260801T000000Z" "$TMP/daily/20260802T000000Z" \
  "$TMP/daily/20260803T000000Z" "$TMP/daily/20260804T000000Z"
echo x > "$TMP/daily/20260801T000000Z/f"
einvoice_retain_dirs "$TMP/daily" 2
[[ ! -d "$TMP/daily/20260801T000000Z" ]] || fail "oldest daily not pruned"
[[ ! -d "$TMP/daily/20260802T000000Z" ]] || fail "second-oldest daily not pruned"
[[ -d "$TMP/daily/20260803T000000Z" ]] || fail "kept daily 03 missing"
[[ -d "$TMP/daily/20260804T000000Z" ]] || fail "kept daily 04 missing"

echo "migrate.mjs refuses einvoice_app..."
if NODE_ENV=production MIGRATE_DATABASE_URL='postgresql://einvoice_app:x@postgres:5432/einvoice' \
  node "$ROOT/apps/api/scripts/migrate.mjs" >/dev/null 2>&1; then
  fail "migrate.mjs should refuse einvoice_app"
fi

echo "migrate.mjs refuses missing URL in production..."
if NODE_ENV=production MIGRATE_DATABASE_URL= node "$ROOT/apps/api/scripts/migrate.mjs" >/dev/null 2>&1; then
  fail "migrate.mjs should refuse missing MIGRATE_DATABASE_URL in production"
fi

echo "OK: deploy/backup script logic"
