#!/usr/bin/env bash
# Shared helpers for production scripts. Source from repo-root scripts only.
# shellcheck shell=bash

einvoice_compose() {
  docker compose -f docker-compose.prod.yml --env-file .env.prod "$@"
}

einvoice_require_env_prod() {
  if [[ ! -f .env.prod ]]; then
    echo "Missing .env.prod — copy from .env.prod.example and fill secrets." >&2
    exit 1
  fi
}

# Fail if MIGRATE_DATABASE_URL is missing or is the RLS app role (einvoice_app).
einvoice_assert_admin_migrate_url() {
  local line url
  line="$(grep -E '^MIGRATE_DATABASE_URL=' .env.prod | tail -n1 || true)"
  url="${line#MIGRATE_DATABASE_URL=}"
  url="${url%\"}"
  url="${url#\"}"
  url="${url%\'}"
  url="${url#\'}"
  if [[ -z "$url" ]]; then
    echo "FATAL: MIGRATE_DATABASE_URL is not set in .env.prod." >&2
    echo "It must be the Postgres owner role (POSTGRES_USER=einvoice), not einvoice_app." >&2
    exit 1
  fi
  if [[ "$url" == *einvoice_app* ]]; then
    echo "FATAL: MIGRATE_DATABASE_URL points at einvoice_app (no schema DDL)." >&2
    echo "Use postgresql://einvoice:<POSTGRES_PASSWORD>@postgres:5432/einvoice?schema=public" >&2
    exit 1
  fi
}

einvoice_wait_postgres() {
  local i
  echo "Waiting for Postgres to be healthy..."
  einvoice_compose up -d postgres
  for i in $(seq 1 45); do
    if einvoice_compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      echo "Postgres is ready."
      return 0
    fi
    sleep 2
  done
  echo "FATAL: Postgres did not become ready." >&2
  einvoice_compose ps postgres || true
  exit 1
}

# Keep the newest $2 timestamped subdirectories under $1; delete older ones.
einvoice_retain_dirs() {
  local dir="$1"
  local keep="$2"
  local extra i
  mkdir -p "$dir"
  if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 )); then
    echo "retain: keep count must be a positive integer (got ${keep})" >&2
    return 1
  fi
  mapfile -t dirs < <(find "$dir" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
  extra=$(( ${#dirs[@]} - keep ))
  if (( extra > 0 )); then
    for (( i = 0; i < extra; i++ )); do
      echo "Pruning old backup ${dirs[$i]}"
      rm -rf "${dirs[$i]}"
    done
  fi
}
