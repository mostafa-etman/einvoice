# Production deployment runbook (Hostinger VPS, Docker)

**Domains**
- Web: `https://eta.erp-esafe.com`
- API: `https://etaapi.erp-esafe.com`

**Local / existing compose is unchanged**
- Dev: `infra/docker-compose.yml` + `pnpm infra:up` (mkcert / host.docker.internal)
- Prod: `docker-compose.prod.yml` + `.env.prod` (this document)

Secrets never go in git. Only `.env.prod.example` is committed.

---

## Prerequisites (VPS)

- Ubuntu 22.04+ (or similar), 2 vCPU / 8GB RAM
- Docker Engine + Compose plugin (`docker compose version`)
- DNS A records for both hosts → VPS public IP
- Ports **80** and **443** open (firewall / Hostinger)
- Git access to this repository

```bash
# Example install (Ubuntu)
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # re-login after
```

---

## First-time deploy

```bash
# 1) Clone
sudo mkdir -p /opt/einvoice
sudo chown "$USER:$USER" /opt/einvoice
cd /opt/einvoice
git clone <YOUR_GITHUB_REPO_URL> .
# or: git clone <url> einvoice && cd einvoice

# 2) Create production env (never commit)
cp .env.prod.example .env.prod
nano .env.prod   # fill EVERY CHANGE_ME — strong passwords & keys

# Generate helpers:
#   openssl rand -base64 48          # passwords / JWT
#   openssl rand -base64 32          # SECRETS_MASTER_KEY, BACKUP_ARCHIVE_MASTER_KEY

# Confirm cookie/CORS block matches domains:
#   COOKIE_DOMAIN=.erp-esafe.com
#   COOKIE_SECURE=true
#   COOKIE_SAMESITE=none
#   COOKIE_PARTITIONED=false
#   CORS_ORIGINS=https://eta.erp-esafe.com
#   NEXT_PUBLIC_API_URL=https://etaapi.erp-esafe.com

# 3) Scripts executable
chmod +x scripts/prod-*.sh infra/postgres/init-prod/*.sh

# 4) Build images (linux/amd64) — web bakes NEXT_PUBLIC_API_URL at build time
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# 5) Start infrastructure first (DB/Redis/MinIO) so migrate can connect
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres redis minio
# wait until healthy
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# 6) Migrate with ADMIN role (MIGRATE_DATABASE_URL) — not the app role
./scripts/prod-migrate.sh
# Exact equivalent:
# docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
#   node ./scripts/migrate.mjs

# 7) Seed (optional first time: owner user + ETA code catalog)
./scripts/prod-seed.sh

# 8) Bring up full stack (Traefik obtains Let's Encrypt certs)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 9) Verify
curl -fsS https://etaapi.erp-esafe.com/health/live
curl -fsSI https://eta.erp-esafe.com | head
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

TLS: Traefik uses HTTP-01 ACME (`le` resolver). Certs persist in volume `einvoice_prod_traefik_acme`. First request may take ~30–60s while certificates are issued.

---

## Updating (one command)

```bash
cd /opt/einvoice
./scripts/prod-deploy.sh
```

That is the safe path. It always:

1. Writes a timestamped **pg_dump + MinIO** snapshot under `./backups/deploy/` (keeps last 5).
2. `git pull --ff-only`.
3. Builds the **api** image, then `prisma migrate deploy` as **MIGRATE_DATABASE_URL** (Postgres owner `einvoice` — never `einvoice_app`).
4. `docker compose … up -d --build --force-recreate web api worker` (postgres/redis/minio stay up).
5. Prints `docker compose ps` and curls `/health/live` inside the containers.

Equivalent migrate-only (already used by deploy):

```bash
./scripts/prod-migrate.sh
# → docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps \
#     api node ./scripts/migrate.mjs
```

`apps/api/scripts/migrate.mjs` sets `DATABASE_URL=$MIGRATE_DATABASE_URL` then runs `npx prisma migrate deploy`. It **refuses** to run if the URL is missing or is `einvoice_app` (that role has no DDL and causes permission-denied / skipped migrations).

If `.env.prod.example` gained new keys, merge them into server `.env.prod` before deploy.

---

## Logs & health

```bash
# All services
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=200

# One service
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api worker web traefik

# Health
curl -fsS https://etaapi.erp-esafe.com/health/live
curl -fsS https://etaapi.erp-esafe.com/health/ready
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

---

## Migrations (important)

| URL | Role | Purpose |
|-----|------|---------|
| `DATABASE_URL` | `einvoice_app` | Runtime API/worker (RLS, no bypass) |
| `MIGRATE_DATABASE_URL` | `POSTGRES_USER` (owner) | `prisma migrate deploy` only |

**Exact migrate command**

```bash
./scripts/prod-migrate.sh
```

or:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node ./scripts/migrate.mjs
```

`apps/api/scripts/migrate.mjs` sets `DATABASE_URL=$MIGRATE_DATABASE_URL` then runs `npx prisma migrate deploy`. It refuses `einvoice_app` and refuses a missing URL in production. Never run migrate as the app role.

---

## Backup & restore

Host backups land in **`/opt/einvoice/backups`** (the gitignored `./backups` directory on the VPS). That is a **host path**, not a container filesystem, so `docker compose up --build --force-recreate` does not delete them.

Layout:

- `backups/daily/<UTC-stamp>/postgres.sql.gz` + `minio.tar.gz`
- `backups/weekly/…` — Sunday copy of that day’s daily (keep 4)
- `backups/deploy/…` — pre-deploy snapshots (keep 5)

Daily job keeps **7 daily + 4 weekly**. Manual: `./scripts/prod-backup.sh --kind daily`

### Install daily cron (once on the VPS)

```bash
cd /opt/einvoice
chmod +x scripts/prod-*.sh
sudo touch /var/log/einvoice-backup.log
sudo chown "$USER" /var/log/einvoice-backup.log
./scripts/prod-install-backup-cron.sh
crontab -l
```

Equivalent crontab line (02:15 UTC every day):

```cron
15 2 * * * cd /opt/einvoice && /usr/bin/flock -n /tmp/einvoice-backup.lock /opt/einvoice/scripts/prod-backup.sh --kind daily >> /var/log/einvoice-backup.log 2>&1
```

### Copy backups OFF the server (required)

A VPS disk failure destroys `./backups` too. From your laptop (or another machine):

```bash
# Recurring (put in Windows Task Scheduler / local cron)
rsync -avz -e ssh USER@VPS_IP:/opt/einvoice/backups/ ~/einvoice-backups/

# One-shot
scp -r USER@VPS_IP:/opt/einvoice/backups/latest-copy .
```

Keep at least the last weekly dump somewhere that is not the VPS (NAS, another VPS, encrypted USB).

### Restore Postgres

```bash
cd /opt/einvoice
./scripts/prod-restore-postgres.sh backups/daily/<stamp>/postgres.sql.gz
# prompts for "yes"; stops api/worker/web; restores as POSTGRES_USER; migrate deploy; starts apps
```

### Restore MinIO (PDFs / uploads)

```bash
cd /opt/einvoice
./scripts/prod-restore-minio.sh backups/daily/<stamp>/minio.tar.gz
```

---

## Change the owner/admin password

There is no in-app “change password” screen. Do **not** re-run `prod-seed.sh` (it can upsert seed users and is not a password-only tool).

Reset **only** the login hash for one email (argon2id, same as the app). Tenant data is not touched. Refresh cookies for that user are revoked.

```bash
cd /opt/einvoice
./scripts/prod-reset-password.sh owner@erp-esafe.com
# type yes, then the new password twice (min 12 characters)
```

Then sign in at `https://eta.erp-esafe.com/login`. Use the email that actually exists (seed default is `SEED_OWNER_EMAIL`, often `owner@erp-esafe.com`).

---

## Desktop signing agent

Point the agent at the **production API** (not localhost):

| Setting | Value |
|---------|--------|
| API base URL | `https://etaapi.erp-esafe.com` |
| TLS | System trust store (Let's Encrypt) — no mkcert |
| Auth | Same pairing / device flow as staging; use production tenant credentials |

Agent `.env` / config example:

```env
API_BASE_URL=https://etaapi.erp-esafe.com
```

No code change required in this deploy; configure the installed agent on each signing PC.

---

## Cookies & CORS (production)

Already env-driven in the API (`COOKIE_*`, `CORS_ORIGINS`). Production values in `.env.prod`:

- Refresh cookie: `Domain=.erp-esafe.com`, `Secure`, `SameSite=None`, `HttpOnly`
- CORS: `https://eta.erp-esafe.com` with credentials
- Web calls API at `NEXT_PUBLIC_API_URL=https://etaapi.erp-esafe.com` (build arg)

Local dev continues to use host-only cookies + Partitioned for `*.localhost` via `apps/api/.env`.

---

## Resource notes (8GB RAM)

Compose sets `mem_limit` roughly: Postgres 1G, Redis 384M, MinIO 512M, API 1.5G, Worker 1.5G, Web 768M, Traefik 256M. Leave headroom for the OS. If OOM, lower worker mem or disable unused sync crons.

---

## Rollback

```bash
git log -1 --oneline
git checkout <previous-good-sha>
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
# DB forward-migrations are not auto-reverted — restore from backup if schema broke.
```
