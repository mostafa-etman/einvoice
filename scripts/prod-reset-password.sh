#!/usr/bin/env bash
# Reset one user's password with the same argon2id parameters as login.
# Does not touch tenants, documents, points, or other business data.
# Revokes that user's refresh sessions so old sessions cannot stay signed in.
#
# Usage (on VPS):
#   ./scripts/prod-reset-password.sh owner@erp-esafe.com
# You will be prompted for the new password (not echoed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=prod-common.sh
source "$ROOT/scripts/prod-common.sh"

EMAIL="${1:-}"
YES=0
if [[ "${1:-}" == "--yes" ]]; then
  YES=1
  EMAIL="${2:-}"
fi
if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 [--yes] user@example.com" >&2
  exit 1
fi

einvoice_require_env_prod
einvoice_wait_postgres

echo "Reset password for: $EMAIL"
if [[ "$YES" -ne 1 ]]; then
  read -r -p "Type yes to continue: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

read -r -s -p "New password (min 12 chars): " PASS
echo
read -r -s -p "Repeat password: " PASS2
echo
if [[ "$PASS" != "$PASS2" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi
if [[ ${#PASS} -lt 12 ]]; then
  echo "Password must be at least 12 characters." >&2
  exit 1
fi

einvoice_compose run --rm --no-deps \
  -e RESET_USER_EMAIL="$EMAIL" \
  -e RESET_USER_PASSWORD="$PASS" \
  api node ./scripts/reset-user-password.mjs

echo "Done. Sign in at https://eta.erp-esafe.com/login with the new password."
echo "Previous sessions for this user were revoked."
