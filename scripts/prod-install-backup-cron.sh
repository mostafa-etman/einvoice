#!/usr/bin/env bash
# Install/update the daily backup crontab on the VPS (Postgres + MinIO).
# Idempotent: replaces any previous einvoice prod-backup.sh line.
#
# Usage (on VPS):
#   ./scripts/prod-install-backup-cron.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="einvoice prod-backup.sh"
CRON_LINE="15 2 * * * cd ${ROOT} && /usr/bin/flock -n /tmp/einvoice-backup.lock ${ROOT}/scripts/prod-backup.sh --kind daily >> /var/log/einvoice-backup.log 2>&1"

touch /var/log/einvoice-backup.log 2>/dev/null || true
if [[ ! -w /var/log/einvoice-backup.log ]]; then
  echo "Cannot write /var/log/einvoice-backup.log — run: sudo touch /var/log/einvoice-backup.log && sudo chown $USER /var/log/einvoice-backup.log" >&2
  exit 1
fi

existing="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$existing" | grep -v "$MARKER" | grep -v 'prod-backup.sh --kind daily' || true)"
printf '%s\n' "$filtered" | grep -v '^$' > /tmp/einvoice-cron.txt || true
echo "$CRON_LINE" >> /tmp/einvoice-cron.txt
crontab /tmp/einvoice-cron.txt
rm -f /tmp/einvoice-cron.txt

echo "Installed daily backup cron (02:15 UTC):"
echo "  $CRON_LINE"
echo
crontab -l | grep prod-backup || true
echo
echo "Keep 7 daily + 4 weekly (Sunday copies). Off-server:"
echo "  rsync -avz -e ssh ${USER}@$(hostname -f 2>/dev/null || hostname):${ROOT}/backups/ ~/einvoice-backups/"
