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

- **Node.js 20 LTS** (required — see below)
- pnpm 11+
- Docker Desktop + WSL2 (Windows)
- .NET 8 SDK
- [mkcert](https://github.com/FiloSottile/mkcert)

### Node.js version (Windows)

This repo pins **Node 20 LTS** (`.nvmrc`, `"engines": { "node": ">=20 <21" }`).
`engine-strict=true` in `.npmrc` blocks installs on other versions.

Using [nvm-windows](https://github.com/coreybutler/nvm-windows):

```powershell
nvm install 20
nvm use 20
node -v   # expect v20.x.x
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

`dev:api` / `dev:web` run `turbo run dev`, which:

1. Builds workspace dependencies (`dependsOn: ["^build"]` in `turbo.json`)
2. Starts `@einvoice/shared` in `tsc --watch` mode alongside the app

### 5. Verify

- Liveness: `https://api.localhost/health/live`
- Readiness: `https://api.localhost/health/ready`
- Landing: `https://web.localhost/ar` (Arabic default / RTL)

Without Compose infra, the web app can still load, but API readiness fails
until Postgres/Redis/MinIO are up.

### 6. Quality gates (same as CI)

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
