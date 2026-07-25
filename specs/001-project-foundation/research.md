# Research: Project Foundation & Skeleton

**Feature**: `001-project-foundation` | **Date**: 2026-07-20

## R1 — Monorepo tooling

**Decision**: pnpm workspaces + Turborepo (`pnpm-workspace.yaml`, `turbo.json`).

**Rationale**: Native fit for NestJS + Next.js TypeScript monorepos; fast
filtered scripts; CI can run `turbo run lint typecheck test build`.

**Alternatives considered**:
- npm/yarn workspaces — weaker filtering and slower installs
- Nx — more powerful but heavier for empty skeleton
- Separate repos — rejected by spec (monorepo required)

## R2 — Repository layout

**Decision**: `apps/{api,web,agent}`, `packages/{shared,eta-core}`, `infra/`.

**Rationale**: Matches clarified app/package names while following common
monorepo conventions; keeps Compose/Traefik out of app trees.

**Alternatives considered**:
- Flat `api/`, `web/` at root — works but muddies tooling boundaries
- `backend/`/`frontend/` naming — conflicts with spec names `api`/`web`

## R3 — API health endpoints

**Decision**: NestJS Terminus (or thin custom controllers) exposing:
- `GET /health/live` — process up → `200` `{ "status": "ok" }`
- `GET /health/ready` — checks PostgreSQL (required); Redis and MinIO when
  their connection env vars are set as required → `200` ready / `503` not ready

**Rationale**: Matches clarification (separate liveness/readiness); aligns with
K8s/Traefik health patterns; DB-only minimum per spec assumptions.

**Alternatives considered**:
- Single `/health` — rejected in clarify
- Readiness always checks all three deps — brittle if MinIO unused early; make
  Redis/MinIO required via env flags in schema

## R4 — Prisma scope this phase

**Decision**: Add Prisma with datasource URL only and a trivial smoke query for
readiness (`SELECT 1`). No business models, migrations for domain tables, or RLS.

**Rationale**: Constitution requires Prisma+RLS eventually; readiness needs a
real DB check without inventing product schema.

**Alternatives considered**:
- Raw `pg` client only — drifts from baseline
- Full starter schema with tenants — violates “no business logic”

## R5 — Local Traefik HTTPS

**Decision**: Traefik v3 in Compose terminates TLS using mkcert-generated certs
under `infra/certs/` (gitignored). Document `mkcert -install` and hostnames
(e.g. `web.localhost`, `api.localhost`). File provider routes to
`host.docker.internal` (or equivalent) host ports for `api`/`web`.

**Rationale**: Clarification requires HTTPS + documented trust; mkcert is the
standard local CA approach on Windows/macOS/Linux.

**Alternatives considered**:
- HTTP only — rejected in clarify
- Self-signed without mkcert — poor DX (constant browser warnings)
- Apps listen HTTPS themselves — duplicates TLS and fights Traefik baseline

## R6 — Web i18n & tokens

**Decision**: Next.js 15 App Router + `next-intl` with `[locale]` segment
(`en`, `ar`), default locale redirect from `/` → `/en`. Tailwind theme maps CSS
variables for colors, spacing, typography; shadcn/ui init optional but token
layer required. Minimal landing content; `dir="rtl"` when `locale === 'ar'`.

**Rationale**: Constitution Principle VII + clarify Q4.

**Alternatives considered**:
- Cookie-only locale — rejected
- Accept-Language only — rejected for testability/shareable URLs

## R7 — Env validation

**Decision**: Shared Zod schemas (or per-app Zod) validated at boot for `api` and
`web`; .NET `IConfiguration` + options validation for `agent`. Fail fast with
named missing keys. Publish human-readable schema in
`contracts/env-schema.md` and `*.env.example` files (placeholders only).

**Rationale**: Clarification Q5 + FR-011/012.

**Alternatives considered**:
- Soft warnings — rejected
- CI-only validation — rejected

## R8 — Agent skeleton

**Decision**: .NET 8 solution with a console (or worker) project + test project;
env validation on start; placeholder unit test. No BouncyCastle/PKCS#11 until
signing feature.

**Rationale**: Spec requires buildable agent without signing behavior;
constitution Complexity Tracking defers crypto wiring.

**Alternatives considered**:
- Full PKCS#11 scaffold — premature
- Omit agent tests — violates FR-014 CI meaningfulness

## R9 — CI

**Decision**: GitHub Actions workflow on push/PR: `lint`, `typecheck`, `test`,
`build` via Turborepo (+ `dotnet` restore/test/build for agent). Node LTS +
.NET 8 SDK on runner.

**Rationale**: FR-010; ubiquitous for GitHub-hosted repos.

**Alternatives considered**:
- GitLab CI / Azure Pipelines — no evidence of host preference; GH Actions default

## R10 — Package stubs

**Decision**: `packages/shared` exports minimal placeholder types (e.g.
`HealthStatus`). `packages/eta-core` exports a stub module/function that throws
or returns “not implemented” and a unit test asserting stub presence—no ETA
HTTP, no serialization.

**Rationale**: FR-007/008/013/014.

**Alternatives considered**:
- Empty packages without tests — CI test stage hollow
- Implement serialization early — out of scope

## Resolved NEEDS CLARIFICATION

None remain from Technical Context; clarify session + research cover tooling,
health, TLS, i18n, env, CI, and layout.
