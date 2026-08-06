# Production deployment runbook (Hostinger VPS, Docker)

**Domains**
- Web: `https://eta.erp-esafe.com`
- API: `https://api.eta.erp-esafe.com`

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
#   NEXT_PUBLIC_API_URL=https://api.eta.erp-esafe.com

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
curl -fsS https://api.eta.erp-esafe.com/health/live
curl -fsSI https://eta.erp-esafe.com | head
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

TLS: Traefik uses HTTP-01 ACME (`le` resolver). Certs persist in volume `einvoice_prod_traefik_acme`. First request may take ~30–60s while certificates are issued.

---

## Updating (git pull → build → migrate → up)

```bash
cd /opt/einvoice
git pull

docker compose -f docker-compose.prod.yml --env-file .env.prod build
./scripts/prod-migrate.sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS https://api.eta.erp-esafe.com/health/ready
```

If `.env.prod.example` gained new keys, merge them into your server `.env.prod` before rebuild.

---

## Logs & health

```bash
# All services
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=200

# One service
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api worker web traefik

# Health
curl -fsS https://api.eta.erp-esafe.com/health/live
curl -fsS https://api.eta.erp-esafe.com/health/ready
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

`scripts/migrate.mjs` sets `DATABASE_URL=$MIGRATE_DATABASE_URL` then runs `npx prisma migrate deploy`. Never run migrate as the app role.

---

## Backup & restore

### Backup

```bash
./scripts/prod-backup.sh
# → ./backups/<UTC-stamp>/postgres.sql.gz
# → ./backups/<UTC-stamp>/minio.tar.gz
```

### Restore Postgres

```bash
# Stop writers first (recommended)
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api worker web

./scripts/prod-restore-postgres.sh backups/<stamp>/postgres.sql.gz
./scripts/prod-migrate.sh   # ensure schema is current

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Restore MinIO

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api worker
docker run --rm \
  -v einvoice_prod_minio:/data \
  -v "$PWD/backups/<stamp>":/backup \
  alpine:3.20 sh -c 'rm -rf /data/* && tar xzf /backup/minio.tar.gz -C /data'
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## Desktop signing agent

Point the agent at the **production API** (not localhost):

| Setting | Value |
|---------|--------|
| API base URL | `https://api.eta.erp-esafe.com` |
| TLS | System trust store (Let's Encrypt) — no mkcert |
| Auth | Same pairing / device flow as staging; use production tenant credentials |

Agent `.env` / config example:

```env
API_BASE_URL=https://api.eta.erp-esafe.com
```

No code change required in this deploy; configure the installed agent on each signing PC.

---

## Cookies & CORS (production)

Already env-driven in the API (`COOKIE_*`, `CORS_ORIGINS`). Production values in `.env.prod`:

- Refresh cookie: `Domain=.erp-esafe.com`, `Secure`, `SameSite=None`, `HttpOnly`
- CORS: `https://eta.erp-esafe.com` with credentials
- Web calls API at `NEXT_PUBLIC_API_URL=https://api.eta.erp-esafe.com` (build arg)

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
