---
description: "Task list for ETA integration core"
---

# Tasks: ETA Integration Core

**Input**: Design documents from `/specs/004-eta-integration-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; feature **003** (encrypted ETA credentials + Redis)

**Tests**: MANDATORY. **Separate** always-on **mocked** unit/API tests from the
**sandbox integration** suite, which MUST skip unless
`ETA_SANDBOX_INTEGRATION=1` (and required sandbox creds/URLs are present).

**Organization**: Phases by user story. API + web (+ tests) before next story
where user-facing. Agent out of scope. No signing/serialization parity tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US4] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Contracts**: `specs/004-eta-integration-core/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Env keys, i18n copy, module shell

- [x] T001 Extend `apps/api/.env.example` and `apps/api/src/config/env.ts` with
      `ETA_IDENTITY_BASE_URL`, `ETA_API_BASE_URL` (required URLs; sandbox/preprod
      defaults documented), and optional `ETA_SANDBOX_INTEGRATION` flag; migrate
      away from sole reliance on legacy `ETA_BASE_URL` per `research.md` R3
- [x] T002 [P] Update `apps/api/src/config/env.validation.spec.ts` and
      `apps/api/test/setup-env.ts` for new ETA URL keys (and test defaults)
- [x] T003 [P] Add ETA connection / document-types copy keys to
      `apps/web/src/messages/ar.json` and `apps/web/src/messages/en.json`
- [x] T004 [P] Document `ETA_SANDBOX_INTEGRATION` skip behavior in
      `specs/004-eta-integration-core/quickstart.md` (verify commands match later
      task IDs)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `EtaModule` clients, Redis token cache, HTTP retry/error map —
**BLOCKS** all stories

**âš ï¸ CRITICAL**: No user story work until this phase completes

- [x] T005 Create `apps/api/src/eta/eta-http.ts` with fetch helper: retry/backoff
      on 5xx and network errors only (no retry on 4xx)
- [x] T006 [P] Create `apps/api/src/eta/eta-errors.ts` mapping OAuth/API errors
      (`invalid_client`, etc.) to stable codes + safe operator messages
- [x] T007 Implement `EtaTokenCache` (Redis keys `eta:token:{tenantId}` /
      `eta:token:{tenantId}:{onbehalfof}`; refresh-due at â‰¥80% of `expires_in`;
      single-flight/lock) in `apps/api/src/eta/eta-token.cache.ts`
- [x] T008 Implement `EtaAuthClient` (Basic auth Base64(clientId:clientSecret),
      `grant_type=client_credentials`, optional onbehalfof; never log secrets) in
      `apps/api/src/eta/eta-auth.client.ts`
- [x] T009 Implement `EtaDocTypesClient` (GET document types / versions from
      `ETA_API_BASE_URL` with Bearer token + Redis catalog cache keys per
      `data-model.md`) in `apps/api/src/eta/eta-doc-types.client.ts`
- [x] T010 Implement `EtaService` orchestration (load 003 credentials via
      tenant context, decrypt in memory only, setup-required when missing,
      `testConnection` / `getAccessToken` / doc-types) in
      `apps/api/src/eta/eta.service.ts`
- [x] T011 Register `EtaModule` + wire into `apps/api/src/app.module.ts` in
      `apps/api/src/eta/eta.module.ts`
- [x] T012 [P] **MOCKED unit** — Basic-auth header builder + token request body
      in `apps/api/src/eta/eta-auth.client.spec.ts` (HTTP fully mocked; never
      calls real ETA)
- [x] T013 [P] **MOCKED unit** — refresh-at-80% + Redis key shapes in
      `apps/api/src/eta/eta-token.cache.spec.ts` (Redis mocked)
- [x] T014 [P] **MOCKED unit** — error mapping cases in
      `apps/api/src/eta/eta-errors.spec.ts`

**Checkpoint**: Clients + mocked unit suite green without sandbox network

---

## Phase 3: User Story 1 - Obtain and reuse ETA access tokens (Priority: P1) ðŸŽ¯ MVP

**Goal**: Token acquire/reuse/refresh via Redis; missing creds â†’ setup error

**Independent Test**: Mocked acquire â†’ reuse before 80% â†’ refresh after 80%;
missing creds returns `ETA_CREDENTIALS_SETUP_REQUIRED` without HTTP to ETA

### Tests for User Story 1 (REQUIRED — mocked only)

- [x] T015 [P] [US1] **MOCKED API** tests for token orchestration + setup-required
      + onbehalfof keying in `apps/api/test/eta.token.spec.ts` (mock
      `EtaAuthClient` / Redis; assert no plaintext secret in responses/audit)

### Implementation for User Story 1

- [x] T016 [US1] Expose internal/service path used by Test Connection to obtain
      tokens (ensure `EtaService.getAccessToken(tenantId, opts)` is the single
      entry) in `apps/api/src/eta/eta.service.ts`
- [x] T017 [US1] Audit token success/failure without token/secret material via
      existing audit service from `EtaService`
- [x] T018 [P] [US1] Ensure setup-required error includes `settingsPath` pointing
      at feature 003 ETA credentials route (contract `EtaSetupError`)

**Checkpoint**: US1 DoD — mocked token lifecycle tests pass

---

## Phase 4: User Story 3 - Connection status + real Test Connection (Priority: P1)

**Goal**: Status card + Test Connection replacing 003 stub; permissions

**Independent Test**: GET status disconnected â†’ POST test-connection (mocked ETA)
â†’ connected; missing creds â†’ setup UI link; Viewer 403 on manage

### Tests for User Story 3 (REQUIRED — mocked)

- [x] T019 [P] [US3] **MOCKED API** contract tests for
      `GET /settings/eta/connection` and
      `POST /settings/eta-credentials/test-connection` in
      `apps/api/test/eta.connection.spec.ts` (mock upstream; assert body never
      contains `access_token` / clientSecret)
- [x] T020 [P] [US3] Frontend smoke for status + Test Connection + setup link
      copy in
      `apps/web/src/app/[locale]/(app)/settings/eta-credentials/eta-connection.smoke.test.tsx`

### Implementation for User Story 3

- [x] T021 [US3] Implement `EtaController` routes per `contracts/eta-api.yaml`
      (`connection`, `test-connection`) with `settings.eta.view|manage` in
      `apps/api/src/eta/eta.controller.ts`
- [x] T022 [US3] Replace 003 Test Connection stub delegation: wire settings
      test-connection endpoint to `EtaService.testConnection` (remove stub-only
      response) in `apps/api/src/settings/eta-credentials/` and/or
      `eta.controller.ts`
- [x] T023 [US3] Build connection status card + real Test Connection + setup
      error link on
      `apps/web/src/app/[locale]/(app)/settings/eta-credentials/page.tsx`
- [x] T024 [P] [US3] API client helpers in `apps/web/src/lib/api/eta.ts`

**Checkpoint**: US3 DoD — mocked connection API + UI smoke pass

---

## Phase 5: User Story 2 - Document types & versions from ETA (Priority: P1)

**Goal**: Fetch/cache/view document types and versions (no hardcoded catalog)

**Independent Test**: Mocked ETA JSON â†’ list types â†’ versions; refresh bypasses
cache; assert catalog not served from hardcoded fixtures

### Tests for User Story 2 (REQUIRED — mocked)

- [x] T025 [P] [US2] **MOCKED API** tests for document-types list/versions/refresh
      in `apps/api/test/eta.document-types.spec.ts` (mock
      `EtaDocTypesClient`/HTTP; fail if live catalog equals hardcoded product
      fixture as source of truth)
- [x] T026 [P] [US2] Frontend smoke for doc-types viewer copy in
      `apps/web/src/app/[locale]/(app)/settings/eta-document-types/doc-types.smoke.test.tsx`

### Implementation for User Story 2

- [x] T027 [US2] Controller routes `GET /settings/eta/document-types` and
      `GET /settings/eta/document-types/{typeId}/versions` (+ refresh query) in
      `apps/api/src/eta/eta.controller.ts`
- [x] T028 [US2] Audit document-types refresh success/failure without secrets
- [x] T029 [US2] Build document types/versions viewer page in
      `apps/web/src/app/[locale]/(app)/settings/eta-document-types/page.tsx`
- [x] T030 [P] [US2] Extend `apps/web/src/lib/api/eta.ts` + settings hub link in
      `apps/web/src/app/[locale]/(app)/settings/page.tsx`

**Checkpoint**: US2 DoD — mocked catalog API + viewer smoke pass

---

## Phase 6: User Story 4 - Environment-safe ETA endpoints (Priority: P2)

**Goal**: Identity/API URLs from env; fail closed if missing; sandbox defaults

**Independent Test**: Missing `ETA_IDENTITY_BASE_URL` fails closed; test env
defaults point at sandbox/preprod hosts

### Tests for User Story 4 (REQUIRED — mocked)

- [x] T031 [P] [US4] **MOCKED** env fail-closed tests when identity/API URL
      missing in `apps/api/src/config/env.validation.spec.ts` (extend) and/or
      `apps/api/test/eta.config.spec.ts`

### Implementation for User Story 4

- [x] T032 [US4] Ensure `EtaAuthClient` / `EtaDocTypesClient` use only
      `ETA_IDENTITY_BASE_URL` / `ETA_API_BASE_URL` (no hardcoded production hosts)
      in `apps/api/src/eta/`
- [x] T033 [P] [US4] Sync CI test env with sandbox URL placeholders in
      `.github/workflows/ci.yml` (do **not** enable `ETA_SANDBOX_INTEGRATION` by
      default)

**Checkpoint**: US4 DoD — config fail-closed covered

---

## Phase 7: Sandbox integration (OPTIONAL / gated) & Polish

**Purpose**: Live sandbox proof **isolated** from default CI; isolation/DoD

### Sandbox integration (MUST be separate file + env guard)

- [x] T034 **SANDBOX INTEGRATION (gated)** — Implement
      `apps/api/test/eta.sandbox.integration.spec.ts` that:
      1. **Skips entire suite** unless `ETA_SANDBOX_INTEGRATION=1`
      2. Requires `ETA_IDENTITY_BASE_URL`, `ETA_API_BASE_URL`, and usable sandbox
         credentials (seeded tenant or env)
      3. Performs real token request + document-types fetch against sandbox
      4. Is **never** imported/required by mocked unit files (`eta-auth.client.spec.ts`,
         `eta-token.cache.spec.ts`, `eta.connection.spec.ts`, etc.)
- [x] T035 [P] Add npm/pnpm script note or jest `testPathIgnorePatterns` /
      doc comment so default `pnpm test` does not fail when flag unset (skip is
      sufficient); document run command in quickstart

### Polish

- [x] T036 [P] RBAC deny tests Viewer cannot Test Connection / refresh types in
      `apps/api/test/eta.rbac.spec.ts` (**mocked**)
- [x] T037 [P] Confirm Redis token keys include `tenantId` and differ for
      onbehalfof in mocked isolation assertions (extend `eta.token.spec.ts` or
      `eta.connection.spec.ts`)
- [x] T038 Run default mocked suite only:
      `pnpm --filter @einvoice/api test -- --testPathPattern="eta\\.(auth|token|connection|document-types|rbac|config)|eta-auth|eta-token|eta-errors" --runInBand`
- [x] T039 Optionally run sandbox suite locally with flag per quickstart
- [x] T040 Confirm no invoice submit/sign/agent scope creep; DoD review vs
      `spec.md` Out of Scope

**Checkpoint**: Default CI green on **mocked** tests; sandbox suite opt-in only

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup â†’ Foundational** â†’ blocks all stories
- **US1** (tokens) MVP after Foundational
- **US3** (Test Connection / status) after US1 token path
- **US2** (doc types) after US1 (needs token)
- **US4** can overlap late Foundational / with US3 (config)
- **Sandbox T034** after US1–US2 clients work; never blocks mocked CI
- **Polish** last

### Recommended sequence

1. Setup T001–T004  
2. Foundational clients + **mocked units** T005–T014  
3. US1 mocked token API T015–T018  
4. US3 connection + UI T019–T024  
5. US2 doc types + UI T025–T030  
6. US4 config T031–T033  
7. Gated sandbox T034–T035 + polish T036–T040  

### Parallel opportunities

- T002–T004 after T001  
- T012–T014 after T007–T009  
- T019–T020; T025–T026; T031  

### MVP

Foundational mocked units + **US1** + **US3** Test Connection (mocked) unlocks
operator value; US2 viewer next; sandbox T034 optional proof.

---

## Implementation Strategy

### MVP first

Ship token cache + status + Test Connection with **mocked** proof in CI.
Enable `ETA_SANDBOX_INTEGRATION=1` only for local/sandbox validation.

### Test separation rules (non-negotiable)

| Suite | Path pattern | Network | Default CI |
|-------|----------------|---------|------------|
| Mocked units | `src/eta/*.spec.ts` | None (mocked) | Run |
| Mocked API | `test/eta.*.spec.ts` except sandbox | None (mocked) | Run |
| Sandbox integration | `test/eta.sandbox.integration.spec.ts` | Real ETA | **Skip** unless `ETA_SANDBOX_INTEGRATION=1` |

- **T027 is not** a substitute for T034 — storage/catalog correctness under mock
  â‰  live sandbox proof  
- Never put live ETA calls inside T012–T014 / T015 / T019 / T025  

### Notes

- Decrypt Client Secret only in memory for token POST; never return
  `access_token` to web  
- Reuse `settings.eta.view` / `settings.eta.manage` from 003  
- Replace 003 stub Test Connection with `EtaService.testConnection`
