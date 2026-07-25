# Implementation Plan: Multi-Tenant Core & Authentication

**Branch**: `002-multi-tenant-auth` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-multi-tenant-auth/spec.md`

## Summary

Add multi-tenant identity and RBAC on the foundation monorepo: Prisma models
(Tenant, User, Role, Permission, Membership, Branch, AuditLog, RefreshSession)
with Postgres RLS keyed on `current_setting('app.tenant_id')`; NestJS AuthModule
(register/login/refresh/logout), tenant-context interceptor that runs each
tenant-scoped request in a transaction with `SET LOCAL app.tenant_id`, RBAC
guard, and audit interceptor; Next.js app shell with Arabic-default i18n,
TanStack Query, react-hook-form + zod, auth/onboarding screens, tenant/branch
switchers, and users/roles management. Tests: unit RBAC + integration proving
tenant A cannot read tenant B.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS + Next.js 15)

**Primary Dependencies**: NestJS, Prisma, `@node-rs/argon2` (argon2id), JWT
(`@nestjs/jwt`), cookie-parser; Next.js 15, next-intl (default `ar`), TanStack
Query, react-hook-form, zod, Tailwind/shadcn patterns

**Storage**: PostgreSQL 16 with RLS policies; refresh token hashes stored
server-side; Redis unused for auth in this feature (optional session denylist later)

**Testing**: Jest unit (RBAC permissions, argon2id verify helpers); Nest
supertest/integration for auth + cross-tenant isolation with real Postgres;
frontend component/smoke tests for locale default + shell routes

**Target Platform**: Local Compose Postgres + host `api`/`web` (existing Traefik HTTPS)

**Project Type**: Multi-tenant SaaS web application (API + web); agent unchanged

**Performance Goals**: Auth endpoints p95 < 500ms locally; list users/roles
p95 < 1s for ≤1k members/tenant (no hard SLA yet)

**Constraints**: argon2id; refresh httpOnly Secure cookies + rotation-on-use;
`SET LOCAL app.tenant_id` per request transaction; seeded roles Owner/Admin/
Accountant/Viewer; Arabic RTL default; no ETA/invoicing logic

**Scale/Scope**: Single-region MVP tenancy; no platform super-admin; basic Branch

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — acceptance tests; AuditLog + audit
  interceptor on mutations; auth success/failure audited
- **II. Security by Default**: PASS — argon2id; httpOnly Secure refresh;
  JWT access short-lived; least-privilege RBAC; no secrets in git
- **III. Multi-Tenant Isolation**: PASS — Prisma `tenantId` + RLS on
  `current_setting('app.tenant_id')` + `SET LOCAL` per transaction
- **IV. Serialization Parity**: N/A — agent/signing out of scope
- **V. Runtime ETA Config**: N/A — no ETA calls
- **VI. Sandbox-First**: PASS (scoped) — JWT secrets per-env; no prod ETA
- **VII. UX/i18n**: PASS — design system shell; `ar` default RTL + `en` LTR
- **VIII. Phased Full-Stack DoD**: PASS — API + web + tests together; agent N/A
- **Stack**: PASS — within Technology Baseline

### Post-Design Re-check (Phase 1)

Gates remain PASS/N/A. Contracts cover auth + tenant admin APIs; data model
includes RLS notes and role permission matrix. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-multi-tenant-auth/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── auth-api.yaml
│   ├── tenant-admin-api.yaml
│   └── permissions.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma          # entities + tenantId
│   └── migrations/            # SQL including ENABLE RLS + policies
├── src/
│   ├── auth/                  # AuthModule: register/login/refresh/logout
│   ├── tenant/                # TenantContext interceptor, onboarding
│   ├── rbac/                  # Permissions, RolesGuard / PermissionsGuard
│   ├── users/                 # membership listing/updates
│   ├── branches/
│   ├── audit/                 # AuditInterceptor + AuditLog service
│   └── prisma/                # transactional client helper (SET LOCAL)
└── test/
    ├── auth.*.spec.ts
    ├── rbac.unit.spec.ts
    └── tenant-isolation.integration.spec.ts

apps/web/
├── src/
│   ├── app/[locale]/(auth)/   # login, register
│   ├── app/[locale]/(app)/    # shell: sidebar/topbar, users, roles
│   ├── components/shell/
│   ├── components/switchers/  # tenant + branch
│   ├── lib/api/               # TanStack Query clients (credentials/cookies)
│   └── messages/ar.json|en.json
└── ...

packages/shared/
└── src/                       # shared Permission codes, DTO types (optional)
```

**Structure Decision**: Extend existing `apps/api` and `apps/web` from foundation.
RLS policies live in Prisma SQL migrations (not Prisma schema DSL). Agent untouched.

## Complexity Tracking

| Violation / Deferral | Why Needed | Simpler Alternative Rejected Because |
|----------------------|------------|--------------------------------------|
| Access token not httpOnly (bearer/memory) while refresh is cookie | SPA needs Authorization header or short-lived readable token for API; refresh stays httpOnly | Dual httpOnly cookies for access+refresh complicates CSRF; clarify requires refresh cookie specifically |
| Permission matrix seeded not fully editable UI for all codes | Roles management screens can assign seeded roles; fine-grained permission editor optional | Full permission matrix UI expands scope beyond MVP screens |
