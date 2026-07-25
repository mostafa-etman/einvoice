# Quickstart Validation: Project Foundation & Skeleton

**Feature**: `001-project-foundation` | **Date**: 2026-07-20

Use this guide to prove the foundation works end-to-end after implementation.
Contracts: [health-api.yaml](./contracts/health-api.yaml),
[env-schema.md](./contracts/env-schema.md).

## Prerequisites

- Node.js LTS, pnpm, Docker Desktop (or Compose-capable Docker)
- .NET 8 SDK
- [mkcert](https://github.com/FiloSottile/mkcert) installed
- Ports free for Postgres, Redis, MinIO, Traefik, and host `api`/`web`

## 1. Certificates & hosts

1. Install local CA: `mkcert -install`
2. Generate certs into `infra/certs/` per README (e.g. `api.localhost`, `web.localhost`)
3. Ensure OS resolves `api.localhost` / `web.localhost` to `127.0.0.1` if needed

**Expect**: Browser trusts Traefik HTTPS without permanent warning.

## 2. Environment

1. Copy `*.env.example` files to local `.env` (gitignored)
2. Confirm values match [env-schema.md](./contracts/env-schema.md) placeholders
3. Negative check: remove a required `api` var → start `api` → **must refuse to boot** naming the var

## 3. Compose infra

```bash
# from repo root
pnpm infra:up
```

**Expect**: Postgres, Redis, MinIO, Traefik healthy/running.

## 4. Start apps on host

```bash
pnpm dev:api
pnpm dev:web
```

**Expect**: Both listen on documented ports; Traefik routes HTTPS to them.

## 5. Health contracts

```bash
curl -sk https://api.localhost/health/live
curl -sk https://api.localhost/health/ready
```

**Expect**:
- Live → `200` with `status: ok` (even if you stop Postgres after start—for a
  separate check, stop Postgres and confirm live still `200`, ready `503`)
- Ready with infra up → `200` with `status: ready`

See [health-api.yaml](./contracts/health-api.yaml).

## 6. Landing page & i18n

1. Open `https://web.localhost/` → redirects to `/en` (or configured default)
2. Open `https://web.localhost/en` → landing uses design tokens
3. Open `https://web.localhost/ar` → Arabic copy + RTL (`dir=rtl`)

## 7. Quality gates locally

```bash
pnpm lint
pnpm typecheck
pnpm exec turbo run test
pnpm exec turbo run build
dotnet test apps/agent/Einvoice.Agent.sln
dotnet build apps/agent/Einvoice.Agent.sln
```

**Expect**: All succeed on clean skeleton.

## 8. Layout smoke

Confirm paths exist: `apps/api`, `apps/web`, `apps/agent`, `packages/shared`,
`packages/eta-core`, `infra/`. Confirm no invoicing/auth/tenancy/ETA submission
code beyond stubs.

## Timing target (SC-001)

A developer with prerequisites already installed should complete steps 1–6
within **30 minutes** using root README + this quickstart.
