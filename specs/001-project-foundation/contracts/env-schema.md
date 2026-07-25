# Environment Variable Schema (Foundation)

All values in examples are **placeholders**. Real secrets MUST NOT be committed.
Apps `api`, `web`, and `agent` MUST fail fast at startup if any **required**
variable for that app is missing.

## Conventions

| Column | Meaning |
|--------|---------|
| Required | Fail boot if unset/empty |
| Secret | Treat as credential; example only in `*.env.example` |
| Default example | Local/dev or sandbox-oriented |

## `api` (`apps/api`)

| Key | Required | Secret | Example | Purpose |
|-----|----------|--------|---------|---------|
| `NODE_ENV` | yes | no | `development` | Runtime mode |
| `PORT` | yes | no | `3001` | Host listen port (Traefik upstream) |
| `DATABASE_URL` | yes | yes | `postgresql://einvoice:einvoice@localhost:5432/einvoice?schema=public` | Postgres for Prisma/readiness |
| `REDIS_URL` | yes | no | `redis://localhost:6379` | Redis (readiness when required) |
| `MINIO_ENDPOINT` | yes | no | `localhost` | MinIO host |
| `MINIO_PORT` | yes | no | `9000` | MinIO API port |
| `MINIO_ACCESS_KEY` | yes | yes | `minioadmin` | MinIO access key (local only) |
| `MINIO_SECRET_KEY` | yes | yes | `minioadmin` | MinIO secret key (local only) |
| `MINIO_USE_SSL` | yes | no | `false` | MinIO TLS to upstream (usually false behind Traefik) |
| `ETA_BASE_URL` | yes | no | `https://api.preprod.invoicing.eta.gov.eg` | Sandbox/preprod placeholder — not production |
| `ETA_CLIENT_ID` | no | yes | `change-me` | Future ETA client id (placeholder) |
| `ETA_CLIENT_SECRET` | no | yes | `change-me` | Future ETA secret (placeholder) |

Foundation readiness: Postgres always checked. Redis/MinIO checked when their
required flags/URLs are present (default: all three required in local `.env.example`).

## `web` (`apps/web`)

| Key | Required | Secret | Example | Purpose |
|-----|----------|--------|---------|---------|
| `NODE_ENV` | yes | no | `development` | Runtime mode |
| `PORT` | yes | no | `3000` | Host listen port |
| `NEXT_PUBLIC_API_URL` | yes | no | `https://api.localhost` | Browser-facing API base (Traefik HTTPS) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | yes | no | `en` | Default locale for `/` redirect |

## `agent` (`apps/agent`)

| Key | Required | Secret | Example | Purpose |
|-----|----------|--------|---------|---------|
| `AGENT_ENVIRONMENT` | yes | no | `Development` | Runtime mode |
| `ETA_BASE_URL` | yes | no | `https://api.preprod.invoicing.eta.gov.eg` | Sandbox placeholder for future use |

## Infra (Compose — documented, not Node-validated)

| Key | Required | Secret | Example | Purpose |
|-----|----------|--------|---------|---------|
| `POSTGRES_USER` | yes | yes | `einvoice` | DB user |
| `POSTGRES_PASSWORD` | yes | yes | `einvoice` | DB password (local only) |
| `POSTGRES_DB` | yes | no | `einvoice` | DB name |
| `MINIO_ROOT_USER` | yes | yes | `minioadmin` | MinIO root |
| `MINIO_ROOT_PASSWORD` | yes | yes | `minioadmin` | MinIO root secret |

## Files to ship

- Root or per-app `*.env.example` matching this schema
- `infra/.env.example` for Compose
- This document kept in sync when keys change
