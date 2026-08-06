#!/usr/bin/env bash
# Backup Postgres + MinIO data directories (Docker named volumes) to ./backups/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$ROOT/backups/$STAMP}"
mkdir -p "$OUT"

echo "Backing up Postgres → $OUT/postgres.sql.gz"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
  | gzip -c > "$OUT/postgres.sql.gz"

echo "Backing up MinIO volume → $OUT/minio.tar.gz"
docker run --rm \
  -v einvoice_prod_minio:/data:ro \
  -v "$OUT":/backup \
  alpine:3.20 tar czf /backup/minio.tar.gz -C /data .

echo "Done: $OUT"
