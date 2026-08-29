#!/usr/bin/env bash
# Postgres pg_dump + MinIO volume backup to a host directory (survives container rebuilds).
#
# Usage:
#   ./scripts/prod-backup.sh                  # daily (default)
#   ./scripts/prod-backup.sh --kind daily
#   ./scripts/prod-backup.sh --kind weekly
#   ./scripts/prod-backup.sh --kind deploy    # pre-deploy snapshot
#   ./scripts/prod-backup.sh --dry-run
#
# Layout (under $BACKUP_ROOT, default ./backups):
#   daily/YYYYMMDDTHHMMSSZ/{postgres.sql.gz,minio.tar.gz,MANIFEST.txt}
#   weekly/...   (Sunday copy of that day's daily, plus --kind weekly)
#   deploy/...   (kept separately, last N deploy snapshots)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

KIND="daily"
DRY_RUN=0
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_DEPLOY="${BACKUP_KEEP_DEPLOY:-5}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"
MINIO_VOLUME="${MINIO_VOLUME:-einvoice_prod_minio}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind)
      KIND="${2:?}"
      shift 2
      ;;
    --keep-daily)
      KEEP_DAILY="${2:?}"
      shift 2
      ;;
    --keep-weekly)
      KEEP_WEEKLY="${2:?}"
      shift 2
      ;;
    --keep-deploy)
      KEEP_DEPLOY="${2:?}"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="${2:?}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$KIND" in
  daily|weekly|deploy) ;;
  *)
    echo "KIND must be daily, weekly, or deploy (got $KIND)" >&2
    exit 1
    ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_ROOT/$KIND/$STAMP"

echo "Backup kind=$KIND stamp=$STAMP dest=$OUT"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would pg_dump → $OUT/postgres.sql.gz"
  echo "[dry-run] would tar MinIO volume $MINIO_VOLUME → $OUT/minio.tar.gz"
  echo "[dry-run] would retain daily=$KEEP_DAILY weekly=$KEEP_WEEKLY deploy=$KEEP_DEPLOY under $BACKUP_ROOT"
  exit 0
fi

einvoice_require_env_prod
mkdir -p "$OUT"

echo "Backing up Postgres → $OUT/postgres.sql.gz"
einvoice_compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
  | gzip -c > "$OUT/postgres.sql.gz"
test -s "$OUT/postgres.sql.gz"

echo "Backing up MinIO volume $MINIO_VOLUME → $OUT/minio.tar.gz"
docker run --rm \
  -v "${MINIO_VOLUME}:/data:ro" \
  -v "$OUT":/backup \
  alpine:3.20 tar czf /backup/minio.tar.gz -C /data .
test -s "$OUT/minio.tar.gz"

{
  echo "stamp=$STAMP"
  echo "kind=$KIND"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
  echo "git=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "postgres=$(wc -c < "$OUT/postgres.sql.gz") bytes gzip"
  echo "minio=$(wc -c < "$OUT/minio.tar.gz") bytes gzip"
} > "$OUT/MANIFEST.txt"

if [[ "$KIND" == "daily" ]]; then
  # Sunday UTC → keep a weekly copy (7=Sunday with date +%u)
  if [[ "$(date -u +%u)" == "7" ]]; then
    WEEKLY_OUT="$BACKUP_ROOT/weekly/$STAMP"
    echo "Sunday backup — copying to $WEEKLY_OUT"
    mkdir -p "$WEEKLY_OUT"
    cp -a "$OUT/." "$WEEKLY_OUT/"
  fi
fi

einvoice_retain_dirs "$BACKUP_ROOT/daily" "$KEEP_DAILY"
einvoice_retain_dirs "$BACKUP_ROOT/weekly" "$KEEP_WEEKLY"
einvoice_retain_dirs "$BACKUP_ROOT/deploy" "$KEEP_DEPLOY"

echo "Done: $OUT"
echo "Off-server copy (run from your laptop):"
echo "  rsync -avz -e ssh USER@VPS:$BACKUP_ROOT/ ~/einvoice-backups/"
