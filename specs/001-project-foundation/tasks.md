---
description: "Task list for project foundation & skeleton"
---

# Tasks: Project Foundation & Skeleton

**Input**: Design documents from `/specs/001-project-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: MANDATORY per constitution Principle I. Every user-visible change MUST
include automated test tasks mapped to acceptance criteria.

**Organization**: Tasks are grouped by user story. Each story/phase MUST cover
Backend + Frontend (+ agent when in scope) with tests before the next phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Agent**: `apps/agent/`
- **Packages**: `packages/shared/`, `packages/eta-core/`
- **Infra**: `infra/`
- **CI**: `.github/workflows/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize monorepo tooling and empty workspace layout

- [x] T001 Create monorepo root files `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, and `.npmrc` at repository root
- [x] T002 Create directory placeholders `apps/api/`, `apps/web/`, `apps/agent/`, `packages/shared/`, `packages/eta-core/`, and `infra/` per `plan.md`
- [x] T003 [P] Add root ESLint flat config `eslint.config.mjs` and Prettier config `.prettierrc` for TypeScript workspaces
- [x] T004 [P] Add root `tsconfig.base.json` with shared compiler options for apps and packages
- [x] T005 [P] Add root `README.md` stub linking to later quickstart steps (prerequisites list only)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Scaffold all workspaces so story work can proceed; wire shared scripts

**âš ï¸ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Scaffold NestJS app skeleton in `apps/api/` (`package.json`, `src/main.ts`, `nest-cli.json`, `tsconfig.json`)
- [x] T007 [P] Scaffold Next.js 15 App Router app in `apps/web/` (`package.json`, `src/app/`, `next.config.ts`, `tsconfig.json`)
- [x] T008 [P] Scaffold .NET 8 solution in `apps/agent/` (`Einvoice.Agent.sln`, `src/Einvoice.Agent/Einvoice.Agent.csproj`, `tests/Einvoice.Agent.Tests/`)
- [x] T009 [P] Scaffold `packages/shared/` with `package.json`, `src/index.ts`, and `tsconfig.json`
- [x] T010 [P] Scaffold `packages/eta-core/` with `package.json`, `src/index.ts`, and `tsconfig.json`
- [x] T011 Wire Turborepo pipeline tasks `lint`, `typecheck`, `test`, `build` in root `turbo.json` and workspace `package.json` scripts
- [x] T012 Add root script aliases in `package.json` for `pnpm lint|typecheck|test|build` and `infra:up` / `infra:down`

**Checkpoint**: All workspaces exist and root scripts resolve â€” user stories may begin

---

## Phase 3: User Story 2 - Work in a multi-app monorepo (Priority: P1)

**Goal**: Distinct buildable apps `api`, `web`, `agent` and packages `shared`, `eta-core` with no business logic

**Independent Test**: List workspaces under `apps/` and `packages/`; each builds; stubs only (no invoicing/auth/tenancy/ETA submission)

### Tests for User Story 2 (REQUIRED)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [US2] Add placeholder unit test in `packages/shared/src/index.test.ts` asserting exported type/helper exists
- [x] T014 [P] [US2] Add stub unit test in `packages/eta-core/src/index.test.ts` asserting stub export is present and does not call ETA
- [x] T015 [P] [US2] Add agent unit test in `apps/agent/tests/Einvoice.Agent.Tests/SmokeTests.cs` asserting project loads

### Implementation for User Story 2

- [x] T016 [P] [US2] Implement minimal `HealthStatus` (or equivalent) placeholder export in `packages/shared/src/index.ts`
- [x] T017 [P] [US2] Implement `eta-core` not-implemented stub export in `packages/eta-core/src/index.ts` (no HTTP, no serialization)
- [x] T018 [US2] Make `apps/api` depend on `packages/shared` via workspace protocol in `apps/api/package.json`
- [x] T019 [P] [US2] Make `apps/web` depend on `packages/shared` via workspace protocol in `apps/web/package.json`
- [x] T020 [US2] Implement agent Program entrypoint skeleton in `apps/agent/src/Einvoice.Agent/Program.cs` (no signing)
- [x] T021 [US2] Verify `pnpm build` and `dotnet build apps/agent/Einvoice.Agent.sln` succeed; document workspace map in root `README.md`

**Checkpoint**: US2 meets Definition of Done for monorepo layout (all five workspaces buildable + tests)

---

## Phase 4: User Story 1 - Boot local development stack (Priority: P1) ðŸŽ¯ MVP

**Goal**: Compose infra (Postgres, Redis, MinIO, Traefik HTTPS); host `api`/`web`; liveness/readiness; bilingual landing page with design tokens

**Independent Test**: Follow `specs/001-project-foundation/quickstart.md` steps 1â€“6 â€” live/ready over HTTPS and `/en` + `/ar` landing

### Tests for User Story 1 (REQUIRED)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T022 [P] [US1] Add contract tests for `GET /health/live` and `GET /health/ready` in `apps/api/test/health.contract.spec.ts` per `specs/001-project-foundation/contracts/health-api.yaml`
- [x] T023 [P] [US1] Add readiness failure test (mocked down dependency) in `apps/api/test/health.readiness.spec.ts`
- [x] T024 [P] [US1] Add web smoke tests for `/en`, `/ar` (RTL), and `/` â†’ locale redirect in `apps/web/src/app/landing.smoke.test.tsx` (or Playwright under `apps/web/tests/`)

### Implementation for User Story 1

- [x] T025 [US1] Author Compose stack in `infra/docker-compose.yml` for postgres, redis, minio, traefik (infra only)
- [x] T026 [P] [US1] Add Traefik static/dynamic config in `infra/traefik/traefik.yml` and `infra/traefik/dynamic/` routing HTTPS to host `api`/`web` ports
- [x] T027 [P] [US1] Add `infra/certs/README.md` documenting mkcert install, cert generation for `api.localhost`/`web.localhost`, and trust steps; gitignore certs in `infra/certs/.gitignore`
- [x] T028 [US1] Add Prisma datasource (no business models) in `apps/api/prisma/schema.prisma` and Prisma client module under `apps/api/src/`
- [x] T029 [US1] Implement liveness and readiness controllers/services in `apps/api/src/health/` matching `contracts/health-api.yaml` (Postgres required; Redis/MinIO per env)
- [x] T030 [US1] Register health module and boot Nest app in `apps/api/src/app.module.ts` and `apps/api/src/main.ts`
- [x] T031 [P] [US1] Add design tokens (colors, spacing, typography) in `apps/web/src/styles/tokens.css` and map into `apps/web/tailwind.config.ts`
- [x] T032 [P] [US1] Configure next-intl with `[locale]` routing in `apps/web/src/i18n/` and `apps/web/src/middleware.ts` (`en`/`ar`, `/` â†’ default locale)
- [x] T033 [US1] Add message catalogs `apps/web/src/messages/en.json` and `apps/web/src/messages/ar.json`
- [x] T034 [US1] Implement landing page in `apps/web/src/app/[locale]/page.tsx` using tokens + `dir` for RTL when `ar`
- [x] T035 [US1] Document Compose up, cert trust, host app start, health URLs, and landing URLs in root `README.md` (align with `quickstart.md`)

**Checkpoint**: US1 DoD â€” infra up, HTTPS health + landing work per quickstart

---

## Phase 5: User Story 4 - Configure services via documented env schema (Priority: P2)

**Goal**: Documented env schemas for all services; fail-fast validation; no real secrets in git; sandbox-oriented examples

**Independent Test**: Compare `*.env.example` to `contracts/env-schema.md`; start `api` without a required var and observe fail-fast error naming it

### Tests for User Story 4 (REQUIRED)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T036 [P] [US4] Add api env validation unit test in `apps/api/src/config/env.validation.spec.ts` (missing required key fails with key name)
- [x] T037 [P] [US4] Add web env validation unit test in `apps/web/src/config/env.validation.spec.ts` (or equivalent) for required public env keys
- [x] T038 [P] [US4] Add agent env validation test in `apps/agent/tests/Einvoice.Agent.Tests/EnvValidationTests.cs`

### Implementation for User Story 4

- [x] T039 [P] [US4] Add `apps/api/.env.example` matching `specs/001-project-foundation/contracts/env-schema.md` (placeholders only; sandbox ETA URL)
- [x] T040 [P] [US4] Add `apps/web/.env.example` matching env-schema.md
- [x] T041 [P] [US4] Add `apps/agent/.env.example` and `infra/.env.example` matching env-schema.md
- [x] T042 [US4] Implement Zod (or equivalent) fail-fast env validation in `apps/api/src/config/env.ts` invoked from `apps/api/src/main.ts`
- [x] T043 [P] [US4] Implement fail-fast env validation for web in `apps/web/src/config/env.ts` invoked at startup
- [x] T044 [US4] Implement fail-fast options validation in `apps/agent/src/Einvoice.Agent/` on startup
- [x] T045 [US4] Ensure `.gitignore` excludes `.env` and `infra/certs/*` (except README); confirm no real secrets committed

**Checkpoint**: US4 DoD â€” schemas documented, fail-fast proven by tests

---

## Phase 6: User Story 3 - Rely on automated quality gates (Priority: P2)

**Goal**: CI runs lint, typecheck, test, and build; failures block green pipeline

**Independent Test**: Push/PR workflow runs all four stages green on skeleton; a deliberate failing test turns the pipeline red

### Tests for User Story 3 (REQUIRED)

- [x] T046 [US3] Add CI workflow smoke assertion doc/checklist in `specs/001-project-foundation/checklists/ci-validation.md` listing lint/typecheck/test/build must-pass jobs (manual validation against Actions run)

### Implementation for User Story 3

- [x] T047 [US3] Create GitHub Actions workflow `.github/workflows/ci.yml` with jobs/steps for `lint`, `typecheck`, `test`, and `build` using pnpm + Turborepo and .NET 8 for `apps/agent`
- [x] T048 [US3] Cache pnpm and NuGet in `.github/workflows/ci.yml` for faster runs
- [x] T049 [US3] Ensure each workspace participates in CI filters (api, web, shared, eta-core, agent) so test stage is non-empty
- [x] T050 [US3] Document how to run the same CI commands locally in root `README.md`

**Checkpoint**: US3 DoD â€” CI green on foundation branch

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Align docs, scripts, and Definition of Done before next feature phase

- [x] T051 [P] Sync `specs/001-project-foundation/quickstart.md` commands with actual root/`package.json` script names
- [x] T052 [P] Add `infra/` Compose healthcheck notes and degraded-mode note (web without infra) to root `README.md`
- [x] T053 Run full local validation per `specs/001-project-foundation/quickstart.md` and fix gaps
- [x] T054 Confirm no business logic (auth product, tenancy, invoicing, ETA submission/serialization) exists beyond stubs â€” checklist note in `specs/001-project-foundation/checklists/scope-boundary.md`
- [x] T055 Definition of Done review: BE + FE + agent + packages + tests + CI before starting next feature phase

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies â€” start immediately
- **Foundational (Phase 2)**: Depends on Setup â€” **BLOCKS** all user stories
- **US2 (Phase 3)**: After Foundational â€” establishes buildable workspaces (P1)
- **US1 (Phase 4)**: After US2 (needs `apps/api` and `apps/web` skeletons) â€” MVP runtime stack
- **US4 (Phase 5)**: After US2 (apps exist); may parallelize with late US1 once `main` entrypoints exist â€” prefer after US1 health/landing boot paths
- **US3 (Phase 6)**: After US1 + US2 + US4 tests exist so CI stages are meaningful
- **Polish (Phase 7)**: After all desired stories complete

### User Story Dependencies

- **US2 (P1)**: After Foundational â€” no dependency on US1
- **US1 (P1)**: After US2 workspace scaffolds
- **US4 (P2)**: After US2; integrates with US1 boot
- **US3 (P2)**: After US1/US2/US4 have scripts and tests

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Contracts before endpoint wiring (US1)
- Env examples before fail-fast validators (US4)
- Story Definition of Done complete before treating next priority as done

### Parallel Opportunities

- Phase 1: T003â€“T005 in parallel
- Phase 2: T007â€“T010 in parallel after T006 starts (or all scaffolds in parallel)
- US2: T013â€“T015 tests in parallel; T016â€“T017 and T019 in parallel
- US1: T022â€“T024 tests in parallel; T026â€“T027, T031â€“T032 in parallel after Compose base
- US4: T036â€“T038 and T039â€“T041 in parallel

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Contract tests in apps/api/test/health.contract.spec.ts"
Task: "Readiness failure test in apps/api/test/health.readiness.spec.ts"
Task: "Landing locale/RTL smoke in apps/web/..."

# Then parallel infra/UI tracks:
Task: "Traefik config in infra/traefik/"
Task: "mkcert docs in infra/certs/README.md"
Task: "Design tokens in apps/web/src/styles/tokens.css"
Task: "next-intl routing in apps/web/src/i18n/"
```

---

## Parallel Example: User Story 2

```bash
Task: "shared unit test in packages/shared/src/index.test.ts"
Task: "eta-core stub test in packages/eta-core/src/index.test.ts"
Task: "agent smoke test in apps/agent/tests/.../SmokeTests.cs"
```

---

## Implementation Strategy

### MVP First (User Story 1 + prerequisite US2)

1. Complete Phase 1â€“2 (Setup + Foundational)
2. Complete Phase 3 (US2) â€” buildable monorepo
3. Complete Phase 4 (US1) â€” Compose + health + landing over HTTPS
4. **STOP and VALIDATE** via `quickstart.md`
5. Demo local boot path

### Incremental Delivery

1. Setup + Foundational â†’ tooling ready
2. US2 â†’ workspaces exist and build
3. US1 â†’ developer can boot stack (MVP!)
4. US4 â†’ safe env configuration
5. US3 â†’ CI enforces quality
6. Polish â†’ docs and DoD gate

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Then:
   - Dev A: US2 packages/agent stubs
   - Dev B: US1 infra + api health
   - Dev C: US1 web i18n/tokens (after web scaffold)
3. US4/US3 after entrypoints exist

---

## Notes

- [P] = different files, no incomplete dependencies
- [USn] maps to spec user stories for traceability
- No RLS, BullMQ workers, BouncyCastle/PKCS#11, or ETA serialization in this feature
- Commit after each task or logical group
- Stop at checkpoints to validate independently
