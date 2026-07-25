# Research: Multi-Tenant Core & Authentication

**Feature**: `002-multi-tenant-auth` | **Date**: 2026-07-20

## R1 — Password hashing

**Decision**: `@node-rs/argon2` (argon2id) for hash/verify.

**Rationale**: Clarification mandates argon2id; Node-native binding is fast and
widely used with NestJS.

**Alternatives considered**: `argon2` (node-gyp heavier), bcrypt (weaker, rejected).

## R2 — Access vs refresh delivery

**Decision**: Short-lived JWT access token returned in JSON (and/or memory on
web client). Refresh token opaque random value; only store hash server-side;
set as `httpOnly`, `Secure`, `SameSite=Lax` (or `Strict` if same-site) cookie;
rotate on every `/auth/refresh` (issue new cookie, invalidate old hash).

**Rationale**: Matches clarify; reduces XSS exfiltration of refresh.

**Alternatives considered**: Both tokens in localStorage (rejected); refresh in
response body (rejected).

## R3 — Prisma + RLS

**Decision**: Models include `tenantId` where tenant-scoped. Migrations run raw
SQL: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, policies using
`tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` (or text
cast matching id type). Request path: open transaction →
`SET LOCAL app.tenant_id = '<uuid>'` → queries → commit/rollback.

**Rationale**: Clarification + constitution Principle III; `SET LOCAL` scopes to
transaction.

**Alternatives considered**: App-only filters (insufficient); session-level SET
without LOCAL (leaks across pooled connections).

## R4 — NestJS request pipeline

**Decision**:
1. JwtAuthGuard on protected routes (access token).
2. TenantContextInterceptor (or middleware + ALS): resolve active tenant from
   header/`X-Tenant-Id` or token claim; verify membership; wrap Prisma work in
   `$transaction` with `SET LOCAL`.
3. PermissionsGuard reading `@RequirePermissions(...)` metadata against
   membership role permissions.
4. AuditInterceptor on successful mutations (POST/PATCH/PUT/DELETE) writing
   AuditLog (who/what/when/tenant/outcome).

**Rationale**: Matches user technical plan; defense in depth.

**Alternatives considered**: Soft tenancy only in services (rejected for RLS).

## R5 — Default role permission matrix

**Decision**: Seed four roles per tenant with codes in `contracts/permissions.md`:

| Permission | Owner | Admin | Accountant | Viewer |
|------------|:-----:|:-----:|:----------:|:------:|
| `tenant.manage` | ✓ | | | |
| `members.manage` | ✓ | ✓ | | |
| `roles.view` | ✓ | ✓ | | ✓ |
| `roles.manage` | ✓ | ✓ | | |
| `branches.manage` | ✓ | ✓ | | |
| `branches.view` | ✓ | ✓ | ✓ | ✓ |
| `members.view` | ✓ | ✓ | ✓ | ✓ |
| `audit.view` | ✓ | ✓ | | |
| `billing.view` | ✓ | ✓ | ✓ | |
| `billing.manage` | ✓ | | ✓ | |

(Billing permissions reserved for future; still seeded for Accountant.)

**Rationale**: Clear least-privilege defaults for Egyptian SME ops roles.

**Alternatives considered**: Only Owner/Viewer — too coarse for stated roles.

## R6 — Web stack

**Decision**: App Router route groups `(auth)` and `(app)` with shell
(sidebar + topbar). `next-intl` defaultLocale `ar`, locales `ar`/`en`, `dir`
from locale. TanStack Query with `credentials: 'include'`. Forms:
react-hook-form + zod resolvers. shadcn/ui components as needed on design tokens.

**Rationale**: User plan + constitution VII; Arabic default from clarify.

**Alternatives considered**: English default (rejected by clarify).

## R7 — CSRF with cookie refresh

**Decision**: Refresh and cookie-authenticated mutating calls use SameSite
cookies; for cross-site Traefik local HTTPS same-site hostnames
(`web.localhost` / `api.localhost` are different sites) — use explicit CSRF
double-submit or align API under same parent host later. **MVP mitigation**:
refresh endpoint requires valid access token nearing expiry OR dedicated CSRF
header matching cookie; document `SameSite=None; Secure` only if cross-site
required in local Traefik split hosts.

**Rationale**: `web.localhost` vs `api.localhost` is cross-site; must not ignore CSRF.

**Alternatives considered**: Ignoring CSRF (rejected). Prefer routing API under
`web.localhost/api` proxy in a follow-up if CSRF complexity bites—flagged for
implementation.

## R8 — Integration test strategy

**Decision**: Testcontainers or Compose Postgres; create tenants A/B; as user A
with `SET LOCAL` A, assert B memberships/branches not returned; also call HTTP
list endpoints with tenant A context expecting zero B rows.

**Rationale**: Spec SC-002 / user plan.

## Resolved unknowns

No NEEDS CLARIFICATION remain for planning; CSRF/same-site detail is an
implementation choice documented in R7.
