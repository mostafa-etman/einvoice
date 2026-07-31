# eInvoice

Multi-tenant Egyptian Tax Authority (ETA) e-invoicing & e-receipts SaaS.

## Workspaces

| Path | Role |
|------|------|
| `apps/api` | NestJS API |
| `apps/web` | Next.js 15 app (en/ar + RTL) |
| `apps/agent` | .NET 8 desktop agent |
| `packages/shared` | Shared TypeScript types & permissions |
| `packages/eta-core` | ETA stub (no live integration yet) |
| `infra/` | Docker Compose: Postgres, Redis, MinIO, Traefik |

## Prerequisites

- **Node.js 20 LTS or Node 24** (supported — see below)
- pnpm 11+
- Docker Desktop + WSL2 (Windows)
- .NET 8 SDK
- [mkcert](https://github.com/FiloSottile/mkcert)

### Node.js version (Windows)

This repo supports **Node 20 LTS and Node 24+** (`.nvmrc` recommends 20 for CI
alignment; `"engines": { "node": ">=20" }` allows both).
`engine-strict=true` in `.npmrc` still rejects Node &lt; 20.

Using [nvm-windows](https://github.com/coreybutler/nvm-windows):

```powershell
nvm install 20   # or: nvm install 24
nvm use 20       # or: nvm use 24
node -v          # expect v20.x.x or v24.x.x
```

Then install dependencies from the repo root:

```powershell
pnpm install
```

## Quick start

### 1. Install

```powershell
pnpm install
pnpm --filter @einvoice/api exec prisma generate
dotnet restore apps/agent/Einvoice.Agent.sln
```

### 2. Environment

```powershell
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
copy apps\agent\.env.example apps\agent\.env
copy infra\.env.example infra\.env
```

Apps fail fast at startup if required variables are missing.

### 3. Local TLS certificates

Follow `infra/certs/README.md`. Traefik expects **exactly**:

- `infra/certs/localhost.pem`
- `infra/certs/localhost-key.pem`

with SANs: `localhost`, `*.localhost`, `api.localhost`, `web.localhost`.

After generating certs: `mkcert -install` (elevated, once), then
`pnpm infra:down && pnpm infra:up`, then fully restart your browser.

### 4. Start infrastructure (Compose = infra only)

```powershell
pnpm infra:up
```

Then start apps **on the host** (Turbo builds `@einvoice/shared` first):

```powershell
pnpm build          # first time or clean clone
pnpm dev:api
pnpm dev:web
```

For a standalone database/client preflight, run `pnpm db:prepare`. It
regenerates Prisma Client and applies committed migrations with
`prisma migrate deploy` using `MIGRATE_DATABASE_URL` (**never**
`migrate reset` — tenant data is preserved). `dev:api` runs this
preflight automatically, so a local API cannot start against a known stale
schema/client. Use the runtime `DATABASE_URL` only for application queries;
the migration role must remain separate because `einvoice_app` has no schema
DDL privileges. On Windows, stop a running API before a manual `db:prepare`
because the process holds Prisma's query-engine DLL open.

Postgres uses the Compose named volume `postgres_data` (`infra_postgres_data`).
`pnpm infra:down` keeps that volume; only `docker compose … down -v` would wipe
it — do not use `-v` for normal restarts.

**Accounts persist across API restarts.** What you lose is the in-memory access
JWT. Silent refresh restores the session from the HttpOnly refresh cookie when
you use `https://web.localhost` (not `http://localhost:3000`). If you land on
login after a restart, sign in again with the same credentials — do not register
a new account.

`dev:api` / `dev:web` then run `turbo run dev`, which:

1. Builds workspace dependencies (`dependsOn: ["^build"]` in `turbo.json`)
2. Starts `@einvoice/shared` in `tsc --watch` mode alongside the app

### 5. Seed a local test account

```powershell
pnpm db:seed
```

Idempotent (safe to re-run any time): upserts tenant `Test Company`, default branch
`Main`, the four system roles, an Owner login `owner@test.local` /
`Password123!`, **and** loads official ETA static code tables (tax types,
subtypes, units, currencies, countries, activity codes, …) from
`apps/api/data/eta-codes/`. The password is hashed with the same argon2id
parameters as `PasswordService`. Re-running resets that password and never
duplicates rows. Override with `SEED_TENANT_NAME`, `SEED_OWNER_EMAIL`,
`SEED_OWNER_PASSWORD`, `SEED_BRANCH_NAME`.

#### TEST ACCESS

| | |
|--|--|
| Login URL | https://web.localhost/ar/login |
| Email | `owner@test.local` |
| Password | `Password123!` |
| Tenant | Test Company |
| Branch | Main |

Refresh code tables from the public SDK `/files/` host (no credentials):

```powershell
pnpm eta:codes:refresh-sdk
```

**Dev only** — never run against a shared or production database.

### 6. Verify

- Liveness: `https://api.localhost/health/live`
- Readiness: `https://api.localhost/health/ready`
- Landing: `https://web.localhost/ar` (Arabic default / RTL)

Without Compose infra, the web app can still load, but API readiness fails
until Postgres/Redis/MinIO are up.

### 7. Quality gates (same as CI)

```powershell
pnpm lint
pnpm typecheck
pnpm exec turbo run test
pnpm exec turbo run build
dotnet test apps/agent/Einvoice.Agent.sln
dotnet build apps/agent/Einvoice.Agent.sln
```

## Local HTTPS + refresh cookies (web.localhost ↔ api.localhost)

Credentialed fetches from `https://web.localhost` to `https://api.localhost`
require:

| Setting | Local value | Why |
|---------|-------------|-----|
| `COOKIE_SECURE` | `true` | Required with `SameSite=None`; Traefik terminates TLS |
| `COOKIE_SAMESITE` | `none` | Sibling `*.localhost` hosts are cross-site for cookies |
| `COOKIE_PARTITIONED` | `true` | **Required** — Chrome blocks cross-site Set-Cookie without CHIPS `Partitioned` |
| `COOKIE_DOMAIN` | **unset** | Host-only on `api.localhost` (`Domain=.localhost` is often rejected) |
| `CORS_ORIGINS` | `https://web.localhost` | Must be explicit (not `*`) with credentials |
| Web `NEXT_PUBLIC_API_URL` | `https://api.localhost` | Client calls API origin with `credentials: 'include'` |

Chromium warning if `Partitioned` is missing (Network → login → Set-Cookie yellow icon):
cookie was blocked because it had `SameSite=None` but not `Partitioned` (third-party cookie phaseout).

After login, DevTools → Application → Cookies → `https://api.localhost` should show
`refresh_token` with **HttpOnly**, **Secure**, **SameSite=None**, **Partitioned**, **Path=/**,
host-only (no Domain). Reload: `POST /auth/refresh` returns 200.
