---
description: "Task list for multi-tenant core & authentication"
---

# Tasks: Multi-Tenant Core & Authentication

**Input**: Design documents from `/specs/002-multi-tenant-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: MANDATORY. Includes a **dedicated** cross-tenant RLS isolation
integration test task under User Story 2.

**Organization**: Phases by user story. API + web (+ tests) before next story
where the story is user-facing. Agent out of scope.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US5] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/002-multi-tenant-auth/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and env for auth/tenancy

- [x] T001 Add API deps `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `cookie-parser`, `@node-rs/argon2` in `apps/api/package.json`
- [x] T002 [P] Add web deps `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod` (if missing) in `apps/web/package.json`
- [x] T003 [P] Extend `apps/api/.env.example` and `contracts` alignment with `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_COOKIE_NAME`, `REFRESH_TTL_DAYS`, `COOKIE_SECURE`
- [x] T004 [P] Export permission code constants in `packages/shared/src/permissions.ts` matching `specs/002-multi-tenant-auth/contracts/permissions.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prisma models, RLS migrations, transactional `SET LOCAL` helper — **BLOCKS** all stories

**⚠️ CRITICAL**: No user story implementation until this phase completes

- [x] T005 Define Prisma models User, Tenant, Branch, Permission, Role, RolePermission, Membership, RefreshSession, AuditLog in `apps/api/prisma/schema.prisma`
- [x] T006 Create migration SQL enabling FORCE RLS + tenant policies on tenant-scoped tables using `current_setting('app.tenant_id')` in `apps/api/prisma/migrations/`
- [x] T007 Implement `withTenantContext(tenantId, fn)` Prisma helper that opens a transaction and runs `SET LOCAL app.tenant_id` in `apps/api/src/prisma/tenant-context.ts`
- [x] T008 [P] Seed global Permission catalog migration/script from `specs/002-multi-tenant-auth/contracts/permissions.md` in `apps/api/prisma/seed.ts` (or SQL seed)
- [x] T009 [P] Implement argon2id hash/verify helpers in `apps/api/src/auth/password.service.ts`
- [x] T010 Wire cookie-parser and global validation pipes in `apps/api/src/main.ts`

**Checkpoint**: Schema + RLS + SET LOCAL helper ready

---

## Phase 3: User Story 1 - Register, create tenant, and sign in (Priority: P1) 🎯 MVP

**Goal**: Email/password auth with JWT access + httpOnly refresh rotation; tenant onboarding as Owner

**Independent Test**: Register → create tenant → logout → login → refresh rotates cookie

### Tests for User Story 1 (REQUIRED)

> Write tests FIRST; ensure they FAIL before implementation

- [x] T011 [P] [US1] Contract/integration tests for register/login/refresh/logout in `apps/api/test/auth.contract.spec.ts` per `contracts/auth-api.yaml`
- [ ] T012 [P] [US1] Unit tests for refresh rotation (old token invalid) in `apps/api/src/auth/refresh.service.spec.ts`
- [x] T013 [P] [US1] Frontend smoke tests for login/register forms in `apps/web/src/app/[locale]/(auth)/auth.smoke.test.tsx`

### Implementation for User Story 1

- [x] T014 [US1] Implement RefreshSession persistence + rotate-on-use in `apps/api/src/auth/refresh.service.ts`
- [x] T015 [US1] Implement AuthService register/login (argon2id) issuing access JWT + Set-Cookie refresh in `apps/api/src/auth/auth.service.ts`
- [x] T016 [US1] Implement AuthController routes in `apps/api/src/auth/auth.controller.ts` matching `contracts/auth-api.yaml`
- [x] T017 [US1] Implement JwtAuthGuard / passport strategy in `apps/api/src/auth/jwt.strategy.ts` and `apps/api/src/auth/jwt-auth.guard.ts`
- [x] T018 [US1] Implement tenant create + Owner membership + default branch + role seed in `apps/api/src/tenant/tenant.service.ts`
- [x] T019 [US1] Expose `POST /tenants` and `GET /tenants` in `apps/api/src/tenant/tenant.controller.ts` per `contracts/tenant-admin-api.yaml`
- [x] T020 [US1] Build login page with RHF+zod in `apps/web/src/app/[locale]/(auth)/login/page.tsx`
- [x] T021 [P] [US1] Build register + onboarding (create tenant) pages in `apps/web/src/app/[locale]/(auth)/register/page.tsx` and `apps/web/src/app/[locale]/(auth)/onboarding/page.tsx`
- [x] T022 [US1] Add TanStack Query auth API client with `credentials: 'include'` in `apps/web/src/lib/api/auth.ts`

**Checkpoint**: US1 DoD — auth + onboarding works end-to-end

---

## Phase 4: User Story 2 - Tenant isolation (RLS) (Priority: P1)

**Goal**: Per-request `SET LOCAL app.tenant_id`; app checks + RLS; no cross-tenant reads

**Independent Test**: Two tenants; A cannot see B via API or DB policy

### Tests for User Story 2 (REQUIRED)

> Write tests FIRST; ensure they FAIL before implementation

- [x] T023 [US2] **DEDICATED — Cross-tenant RLS isolation integration test**: Create tenants A and B with distinct Membership/Branch rows; in a transaction `SET LOCAL app.tenant_id` to A and assert queries return **zero** B rows; also assert HTTP list endpoints under tenant A context never return B data — implement in `apps/api/test/tenant-isolation.integration.spec.ts` (must run against real Postgres with RLS enabled; do not mock away RLS)
- [x] T024 [P] [US2] Unit/integration tests that missing/invalid `X-Tenant-Id` rejects tenant-scoped routes in `apps/api/test/tenant-context.spec.ts`

### Implementation for User Story 2

- [x] T025 [US2] Implement TenantContext interceptor/middleware verifying membership and wrapping handlers with `withTenantContext` in `apps/api/src/tenant/tenant-context.interceptor.ts`
- [x] T026 [US2] Require `X-Tenant-Id` on tenant-scoped controllers (branches/members/roles) in `apps/api/src/`
- [x] T027 [US2] Ensure all tenant-scoped Prisma reads/writes go through `withTenantContext` in services under `apps/api/src/`
- [x] T028 [US2] Document how to run the RLS isolation suite in `specs/002-multi-tenant-auth/quickstart.md` and root `README.md`

**Checkpoint**: US2 DoD — T023 passes (RLS proven)

---

## Phase 5: User Story 3 - App shell, i18n, switchers (Priority: P1)

**Goal**: Unified shell; Arabic default RTL; English LTR; tenant/branch switchers

**Independent Test**: Shell loads in `ar` RTL; switch to `en`; switch tenant/branch

### Tests for User Story 3 (REQUIRED)

- [x] T029 [P] [US3] Smoke tests: default locale `ar` + `dir=rtl`, English switches to `ltr` in `apps/web/src/app/[locale]/(app)/shell.smoke.test.tsx`
- [x] T030 [P] [US3] Unit/smoke for tenant & branch switcher selection persistence in `apps/web/src/components/switchers/switchers.test.tsx`

### Implementation for User Story 3

- [x] T031 [US3] Change product default locale to `ar` in `apps/web/src/i18n/config.ts` and middleware
- [x] T032 [US3] Build app shell (sidebar + topbar) in `apps/web/src/components/shell/` and `apps/web/src/app/[locale]/(app)/layout.tsx`
- [x] T033 [P] [US3] Implement TenantSwitcher using `GET /tenants` in `apps/web/src/components/switchers/tenant-switcher.tsx`
- [x] T034 [P] [US3] Implement BranchSwitcher using `GET /branches` in `apps/web/src/components/switchers/branch-switcher.tsx`
- [x] T035 [US3] Persist active tenant/branch client state and send `X-Tenant-Id` from `apps/web/src/lib/api/client.ts`
- [x] T036 [US3] Expand `apps/web/src/messages/ar.json` and `en.json` for shell/auth/nav copy
- [x] T037 [US3] Implement `GET /branches` in `apps/api/src/branches/` for switcher data

**Checkpoint**: US3 DoD — bilingual shell + switchers

---

## Phase 6: User Story 4 - Users & roles management (Priority: P2)

**Goal**: RBAC guard; list/assign members; list seeded roles; deny without permission

**Independent Test**: Owner manages members; Viewer denied `members.manage`

### Tests for User Story 4 (REQUIRED)

- [x] T038 [P] [US4] Unit tests for PermissionsGuard / permission matrix (Owner/Admin/Accountant/Viewer) in `apps/api/src/rbac/permissions.guard.spec.ts`
- [x] T039 [P] [US4] API tests allow/deny members.manage and roles.view in `apps/api/test/rbac.members.spec.ts`
- [x] T040 [P] [US4] Frontend smoke for users & roles pages render (permission-gated) in `apps/web/src/app/[locale]/(app)/users/users.smoke.test.tsx`

### Implementation for User Story 4

- [x] T041 [US4] Implement PermissionsGuard + `@RequirePermissions()` decorator in `apps/api/src/rbac/`
- [x] T042 [US4] Implement members list/add/update-role endpoints in `apps/api/src/users/` per `contracts/tenant-admin-api.yaml`
- [x] T043 [US4] Implement `GET /roles` in `apps/api/src/rbac/roles.controller.ts`
- [x] T044 [US4] Build Users management screen in `apps/web/src/app/[locale]/(app)/users/page.tsx`
- [x] T045 [US4] Build Roles management screen in `apps/web/src/app/[locale]/(app)/roles/page.tsx`
- [x] T046 [US4] Wire TanStack Query hooks for members/roles in `apps/web/src/lib/api/members.ts` and `roles.ts`

**Checkpoint**: US4 DoD — RBAC enforced API + UI

---

## Phase 7: User Story 5 - Audit logging (Priority: P2)

**Goal**: Append-only AuditLog for auth and admin mutations

**Independent Test**: Login fail/success, tenant create, role change create audit rows; no update/delete API

### Tests for User Story 5 (REQUIRED)

- [ ] T047 [P] [US5] Tests asserting audit rows for login success/failure and tenant create in `apps/api/test/audit.spec.ts`
- [ ] T048 [P] [US5] Test that update/delete audit endpoints are absent or rejected in `apps/api/test/audit.append-only.spec.ts`

### Implementation for User Story 5

- [x] T049 [US5] Implement AuditService writing append-only rows in `apps/api/src/audit/audit.service.ts`
- [x] T050 [US5] Implement AuditInterceptor logging mutations (who/what/when/tenant/outcome) in `apps/api/src/audit/audit.interceptor.ts`
- [x] T051 [US5] Emit auth audit events from AuthService (success/failure) in `apps/api/src/auth/auth.service.ts`
- [x] T052 [US5] Register AuditInterceptor globally or on mutating controllers in `apps/api/src/app.module.ts`

**Checkpoint**: US5 DoD — audit trail verified

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T053 [P] Sync env examples and CSRF/same-site notes for `web.localhost`/`api.localhost` in `apps/api/.env.example` and `README.md`
- [x] T054 [P] Ensure CI runs `tenant-isolation.integration.spec.ts` (Postgres service) in `.github/workflows/ci.yml`
- [ ] T055 Run `specs/002-multi-tenant-auth/quickstart.md` validation end-to-end
- [x] T056 Confirm no ETA/invoicing/agent signing scope creep; Definition of Done review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational** → blocks all stories
- **US1** (auth/onboarding) before **US3** switchers (needs tokens/tenants)
- **US2** (RLS) can start after Foundational; should complete **T023** before calling tenancy Done — prefer after T007/T006; can parallelize with late US1 once models exist
- **US4** after US1 + US2 context/guards
- **US5** after US1 (auth events) and US4 (admin mutations)
- **Polish** last

### Recommended sequence

1. Setup + Foundational  
2. US1 (MVP auth)  
3. US2 (**T023 RLS isolation test** + interceptor)  
4. US3 shell/i18n/switchers  
5. US4 RBAC UI/API  
6. US5 audit  
7. Polish + CI Postgres for T023  

### Parallel Opportunities

- T002–T004; T008–T009  
- US1 tests T011–T013; pages T020–T021  
- US2: T024 parallel with T025 after T023 skeleton exists  
- US3: T029–T030; T033–T034  
- US4: T038–T040; T044–T045  

---

## Parallel Example: User Story 2 (RLS)

```bash
# Dedicated isolation test first (must fail until RLS + SET LOCAL work):
Task: "T023 DEDICATED cross-tenant RLS isolation in apps/api/test/tenant-isolation.integration.spec.ts"

# Then parallel:
Task: "T024 missing X-Tenant-Id rejection tests"
Task: "T025 TenantContext interceptor"
```

---

## Implementation Strategy

### MVP

1. Foundational (schema + RLS SQL + SET LOCAL helper)  
2. US1 auth + onboarding  
3. US2 + **T023 passing**  
4. Stop and validate quickstart auth + isolation  

### Incremental

US3 shell → US4 RBAC screens → US5 audit → CI polish  

---

## Notes

- **T023 is non-negotiable** for Principle III / SC-002 — do not fold into a generic “tenancy tests” task  
- Refresh = httpOnly Secure cookie, rotate on use; passwords = argon2id  
- Default roles: Owner, Admin, Accountant, Viewer  
- Default locale: Arabic (RTL)  
- Commit after each task or logical group  
