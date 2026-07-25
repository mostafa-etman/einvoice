# Implementation Plan: Project Foundation & Skeleton

**Branch**: `001-project-foundation` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-project-foundation/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Stand up a production-aligned monorepo skeleton for the ETA e-invoicing SaaS with
apps `api` (NestJS), `web` (Next.js 15), and `agent` (.NET 8), plus packages
`shared` and `eta-core` (stubs). Local Compose runs Postgres, Redis, MinIO, and
Traefik (HTTPS via mkcert); `api`/`web` run on the host. Deliver API
liveness/readiness, bilingual landing page (`/en`, `/ar`), design tokens, env
schemas with fail-fast validation, CI (lint/typecheck/test/build), and docs—no
business logic.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10+/Next.js 15); C# / .NET 8 (agent)

**Primary Dependencies**: NestJS, Prisma, Next.js 15, Tailwind CSS, shadcn/ui
scaffolding (tokens-first), next-intl, TanStack Query (wired minimally), pnpm
workspaces + Turborepo, Zod (env validation), Traefik, mkcert; agent: .NET 8
console/library skeleton (BouncyCastle/PKCS#11 deferred)

**Storage**: PostgreSQL 16 (Compose; Prisma client for readiness only—no business
schema/RLS yet), Redis 7, MinIO

**Testing**: Jest (api + packages), Playwright or Next test runner smoke for web
locale/RTL, `dotnet test` for agent; contract tests for health endpoints

**Target Platform**: Local Windows/Linux/macOS host apps + Docker Compose infra;
CI on GitHub Actions (Linux); agent builds on Windows and Linux SDK

**Project Type**: Multi-tenant SaaS monorepo foundation + desktop agent skeleton

**Performance Goals**: N/A for foundation—health endpoints respond in <2s under
local load; no throughput SLOs this phase

**Constraints**: No business logic; no real secrets in git; TLS via Traefik HTTPS
locally; env fail-fast; sandbox/local ETA URL placeholders only; RLS/business
audit deferred until tenant models exist

**Scale/Scope**: 3 apps + 2 packages + infra Compose + CI; zero product features

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — acceptance criteria + automated tests for
  liveness/readiness, landing locales, env fail-fast, CI stages. Product audit
  log N/A (no business actions); explicitly out of scope.
- **II. Security by Default**: PASS (scoped) — no secrets in git; env schema marks
  secrets; Traefik HTTPS with documented local certs. At-rest ETA credential
  encryption N/A until credentials exist (placeholders only).
- **III. Multi-Tenant Isolation**: PASS (scoped) — no tenant-scoped tables yet;
  Postgres provisioned only. RLS deferred to first tenant-data feature.
- **IV. Serialization Parity**: N/A — `eta-core` stub only; no vectors this phase.
- **V. Runtime ETA Config**: PASS — env placeholders for ETA base URL/creds; no
  hardcoded live endpoints in source.
- **VI. Sandbox-First**: PASS — example env uses local/sandbox-oriented values.
- **VII. UX/i18n**: PASS — design tokens + next-intl `/en`/`/ar` + RTL.
- **VIII. Phased Full-Stack DoD**: PASS — `api` + `web` + `agent` + packages +
  tests + CI ship together before next phase.
- **Stack**: PASS — within Technology Baseline; agent crypto libs deferred (see
  Complexity Tracking).

### Post-Design Re-check (Phase 1)

All gates remain PASS/N/A as above. Contracts document health + env schema;
data model is configuration-oriented (no tenant tables). No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── health-api.yaml
│   └── env-schema.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
apps/
├── api/                     # NestJS
│   ├── src/
│   │   ├── health/
│   │   ├── config/
│   │   └── main.ts
│   ├── prisma/              # minimal datasource; no business models
│   └── test/
├── web/                     # Next.js 15 App Router
│   ├── src/
│   │   ├── app/[locale]/
│   │   ├── components/
│   │   ├── messages/        # en.json, ar.json
│   │   └── styles/          # design tokens → Tailwind theme
│   └── ...
└── agent/                   # .NET 8 solution/project skeleton
    ├── src/
    └── tests/

packages/
├── shared/                  # shared TypeScript types
│   └── src/
└── eta-core/                # ETA stub (placeholder exports only)
    └── src/

infra/
├── docker-compose.yml       # postgres, redis, minio, traefik
├── traefik/
│   ├── traefik.yml
│   └── dynamic/
└── certs/                   # gitignored generated certs; README for mkcert

.github/workflows/ci.yml
.env.example                 # or per-app *.env.example + root schema doc
turbo.json
pnpm-workspace.yaml
package.json
README.md
```

**Structure Decision**: Use `apps/*` + `packages/*` + `infra/` (pnpm workspaces +
Turborepo). Spec names (`api`, `web`, `agent`, `shared`, `eta-core`) map to
`apps/api`, `apps/web`, `apps/agent`, `packages/shared`, `packages/eta-core`.
Compose is infra-only; Traefik routes host-published `api`/`web` ports over HTTPS.

## Complexity Tracking

| Violation / Deferral | Why Needed | Simpler Alternative Rejected Because |
|----------------------|------------|--------------------------------------|
| Agent without BouncyCastle/PKCS#11 wired | Skeleton-only phase; no signing yet | Shipping unused crypto deps adds noise; constitution allows agent stub until signing phase |
| Prisma without RLS policies | No tenant tables in this feature | Empty RLS would be theater; first tenant model feature must add RLS |
| BullMQ/queues not wired | No jobs yet; Redis provisioned for readiness/future | Premature queue workers violate “no business logic” |
