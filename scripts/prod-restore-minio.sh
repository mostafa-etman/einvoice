#!/usr/bin/env bash
# Restore MinIO object storage from a tar.gz produced by prod-backup.sh.
# WARNING: replaces files in the MinIO data volume (PDFs/uploads).
#
# Usage:
#   ./scripts/prod-restore-minio.sh backups/daily/20260829T020000Z/minio.tar.gz
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

ARCHIVE="${1:?path to minio.tar.gz required}"
MINIO_VOLUME="${MINIO_VOLUME:-einvoice_prod_minio}"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Archive not found: $ARCHIVE" >&2
  exit 1
fi

einvoice_require_env_prod
echo "WARNING: This REPLACES MinIO data in volume $MINIO_VOLUME."
echo "Archive: $ARCHIVE"
read -r -p "Type yes to continue: " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

ABS="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
STAGE="$(mktemp -d)"
cp "$ABS" "$STAGE/minio.tar.gz"

echo "Stopping api/worker (they write to MinIO)..."
einvoice_compose stop api worker

docker run --rm \
  -v "${MINIO_VOLUME}:/data" \
  -v "$STAGE":/backup \
  alpine:3.20 sh -c 'find /data -mindepth 1 -delete; tar xzf /backup/minio.tar.gz -C /data'
rm -rf "$STAGE"

einvoice_compose up -d api worker
echo "MinIO restore complete."
