---
description: "Task list for tenant settings"
---

# Tasks: Tenant Settings

**Input**: Design documents from `/specs/003-tenant-settings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md

**Tests**: MANDATORY. Includes a **dedicated** test that loads the
`tenant_eta_credentials` DB row after save and asserts
`client_secret_ciphertext` is present and does **not** contain the plaintext
secret (and nonce is non-empty).

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
- **Contracts**: `specs/003-tenant-settings/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and env for settings / encryption

- [x] T001 Add API dep `libsodium-wrappers` (and types if needed) in `apps/api/package.json`
- [x] T002 [P] Extend `apps/api/.env.example` and `apps/api/src/config/env.ts` with `SECRETS_MASTER_KEY` (base64 32-byte key; fail-fast when missing outside test)
- [x] T003 [P] Add settings permission codes + role matrix updates in `packages/shared/src/permissions.ts` per `contracts/permissions.md`; rebuild shared
- [x] T004 [P] Add settings nav/copy keys to `apps/web/src/messages/ar.json` and `apps/web/src/messages/en.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, RLS, encryption service, settings module shell — **BLOCKS** all stories

**⚠️ CRITICAL**: No user story implementation until this phase completes

- [x] T005 Extend Prisma models in `apps/api/prisma/schema.prisma`: Branch fields (`isActive`, `etaBranchCode`, `activityCode`, `defaultCurrencyCode`); `Currency`; `TenantCurrency`; `ExchangeRate`; `TenantEtaCredential` (ciphertext + nonce bytes); `ItemCode` (EGS|GS1) per `data-model.md`
- [x] T006 Create migration SQL + FORCE RLS policies for `tenant_currencies`, `exchange_rates`, `tenant_eta_credentials`, `item_codes` (and update `branches` policy if needed) under `apps/api/prisma/migrations/`; seed EGP/USD/EUR in `Currency`
- [x] T007 Implement `SecretsEncryptionService` (encrypt → `{ciphertext, nonce}`, decrypt in memory only; never log plaintext) in `apps/api/src/crypto/secrets-encryption.service.ts`
- [x] T008 [P] Unit tests for encrypt/decrypt round-trip and reject empty key in `apps/api/src/crypto/secrets-encryption.service.spec.ts`
- [x] T009 Register crypto + empty Settings module wiring in `apps/api/src/settings/settings.module.ts` and `apps/api/src/app.module.ts`
- [x] T010 [P] Add settings hub route shell `apps/web/src/app/[locale]/(app)/settings/page.tsx` and sidebar link in `apps/web/src/components/shell/app-shell.tsx`
- [x] T011 [P] Define `ExchangeRateProvider` interface + `NoopExchangeRateProvider` in `apps/api/src/settings/exchange-rates/exchange-rate-provider.ts`

**Checkpoint**: Schema + RLS + encryption ready

---

## Phase 3: User Story 1 - Manage branches (Priority: P1) ðŸŽ¯ MVP

**Goal**: CRUD/deactivate branches with ETA branch/activity codes and optional default currency; exactly one default among active branches

**Independent Test**: Owner creates second branch with ETA fields; switcher lists it; cannot deactivate sole default

### Tests for User Story 1 (REQUIRED)

- [x] T012 [P] [US1] API tests for branch create/update/default rules in `apps/api/test/settings.branches.spec.ts`
- [x] T013 [P] [US1] Frontend smoke for settings branches page in `apps/web/src/app/[locale]/(app)/settings/branches/branches.smoke.test.tsx`

### Implementation for User Story 1

- [x] T014 [US1] Extend branch service/controller CRUD (list/create/patch, default uniqueness, isActive) in `apps/api/src/tenant/` or `apps/api/src/settings/branches/` matching `contracts/settings-api.yaml`
- [x] T015 [US1] Enforce `branches.view` / `branches.manage` on branch settings routes
- [x] T016 [US1] Audit branch create/update/deactivate via existing audit service
- [x] T017 [US1] Build Branches settings UI with RHF+zod in `apps/web/src/app/[locale]/(app)/settings/branches/page.tsx`
- [x] T018 [P] [US1] TanStack Query client for branches in `apps/web/src/lib/api/branches.ts` (extend if exists)

**Checkpoint**: US1 DoD — branch settings usable end-to-end

---

## Phase 4: User Story 2 - Currencies & exchange rates (Priority: P1)

**Goal**: Enable currencies, tenant/branch defaults, manual rates; provider interface only

**Independent Test**: Enable USD, set EGP default, add manual rate, resolve rate for pair/date

### Tests for User Story 2 (REQUIRED)

- [x] T019 [P] [US2] API tests for currency enable/default + manual rate CRUD/overlap reject in `apps/api/test/settings.currencies.spec.ts`
- [x] T020 [P] [US2] Frontend smoke for currencies settings in `apps/web/src/app/[locale]/(app)/settings/currencies/currencies.smoke.test.tsx`

### Implementation for User Story 2

- [x] T021 [US2] Implement currency catalog + tenant currency endpoints in `apps/api/src/settings/currencies/`
- [x] T022 [US2] Implement manual exchange-rate CRUD + lookup in `apps/api/src/settings/exchange-rates/` using `NoopExchangeRateProvider` only for "provider" path
- [x] T023 [US2] Wire `settings.currencies.view|manage` permissions; audit currency/rate mutations
- [x] T024 [US2] Build Currencies settings UI (enable, default, rates table) in `apps/web/src/app/[locale]/(app)/settings/currencies/page.tsx`
- [x] T025 [P] [US2] API clients in `apps/web/src/lib/api/currencies.ts` and `apps/web/src/lib/api/exchange-rates.ts`

**Checkpoint**: US2 DoD — manual FX usable

---

## Phase 5: User Story 3 - ETA credentials (Priority: P1)

**Goal**: Upsert tenant/branch credentials; encrypt secret; mask + rotate; Test Connection stub

**Independent Test**: Save secret → GET masked → **DB row ciphertext ≠ plaintext** → rotate → stub test-connection

### Tests for User Story 3 (REQUIRED)

- [x] T026 [P] [US3] API contract tests for upsert/get/rotate/test-connection (masked response, no plaintext) in `apps/api/test/settings.eta-credentials.spec.ts`
- [x] T027 [US3] **DEDICATED — Stored credential encryption inspection test**: After PUT credentials with a known plaintext secret, load `tenant_eta_credentials` via Prisma/SQL and assert (1) `client_secret_ciphertext` is non-empty Buffer/bytes, (2) `client_secret_nonce` is non-empty, (3) ciphertext UTF-8/hex representation does **not** include the plaintext secret string, (4) optional decrypt round-trip via `SecretsEncryptionService` recovers plaintext **only** in memory — implement in `apps/api/test/settings.eta-credentials.ciphertext.spec.ts` (must hit real Postgres; do not mock away persistence)
- [x] T028 [P] [US3] Frontend smoke for ETA credentials page (masked field + rotate control present) in `apps/web/src/app/[locale]/(app)/settings/eta-credentials/eta.smoke.test.tsx`

### Implementation for User Story 3

- [x] T029 [US3] Implement `TenantEtaCredential` service (upsert, resolve branch→tenant fallback, rotate, never return plaintext) in `apps/api/src/settings/eta-credentials/eta-credentials.service.ts`
- [x] T030 [US3] Implement controller routes per `contracts/settings-api.yaml` in `apps/api/src/settings/eta-credentials/eta-credentials.controller.ts` with `settings.eta.view|manage`
- [x] T031 [US3] Implement Test Connection stub (validate required fields; return `{ status: 'stub', ... }`; decrypt only if needed later—none for stub) in same module
- [x] T032 [US3] Audit `settings.eta_credentials.upsert|rotate` without secret material in metadata
- [x] T033 [US3] Build ETA credentials UI with masked secret, rotate dialog, Test Connection button in `apps/web/src/app/[locale]/(app)/settings/eta-credentials/page.tsx`
- [x] T034 [P] [US3] API client in `apps/web/src/lib/api/eta-credentials.ts`

**Checkpoint**: US3 DoD — T027 passes (ciphertext proven in DB)

---

## Phase 6: User Story 4 - Item codes EGS/GS1 (Priority: P2)

**Goal**: Local item code CRUD; types EGS|GS1 only; sync placeholder

**Independent Test**: Create EGS + GS1; reject other type; search; sync control shows placeholder

### Tests for User Story 4 (REQUIRED)

- [x] T035 [P] [US4] API tests for item-code CRUD, uniqueness, type validation in `apps/api/test/settings.item-codes.spec.ts`
- [x] T036 [P] [US4] Frontend smoke for item codes page in `apps/web/src/app/[locale]/(app)/settings/item-codes/item-codes.smoke.test.tsx`

### Implementation for User Story 4

- [x] T037 [US4] Implement item-codes service/controller in `apps/api/src/settings/item-codes/` per contract
- [x] T038 [US4] Wire `settings.item_codes.view|manage`; audit mutations
- [x] T039 [US4] Build Item codes UI + disabled/placeholder "Sync with ETA" in `apps/web/src/app/[locale]/(app)/settings/item-codes/page.tsx`
- [x] T040 [P] [US4] API client in `apps/web/src/lib/api/item-codes.ts`

**Checkpoint**: US4 DoD — local catalog works

---

## Phase 7: User Story 5 - Settings shell i18n & RBAC UX (Priority: P2)

**Goal**: Settings nav complete in ar/en; Viewer denied manage actions

**Independent Test**: Navigate all four areas in ar and en; Viewer gets 403 / disabled UI on manage

### Tests for User Story 5 (REQUIRED)

- [x] T041 [P] [US5] API RBAC deny tests for Viewer on currencies/ETA/item manage in `apps/api/test/settings.rbac.spec.ts`
- [x] T042 [P] [US5] Shell/settings smoke: default ar RTL + en LTR labels exist in `apps/web/src/app/[locale]/(app)/settings/settings.smoke.test.tsx`

### Implementation for User Story 5

- [x] T043 [US5] Finalize settings hub links + permission-aware UI affordances in `apps/web/src/app/[locale]/(app)/settings/page.tsx` and shell nav
- [x] T044 [US5] Ensure message catalogs cover all settings screens in `apps/web/src/messages/ar.json` and `en.json`

**Checkpoint**: US5 DoD — bilingual settings + RBAC UX

---

## Phase 8: Cross-tenant isolation & Polish

- [x] T045 [P] **Settings isolation integration test**: tenant A cannot read B's currencies/rates/credentials/item codes/branches under `SET LOCAL` + HTTP in `apps/api/test/settings-isolation.integration.spec.ts`
- [x] T046 [P] Sync `SECRETS_MASTER_KEY` into CI env for API tests in `.github/workflows/ci.yml`
- [x] T047 [P] Document validation steps already in `specs/003-tenant-settings/quickstart.md` (verify commands match task IDs T027/T045)
- [x] T048 Run `specs/003-tenant-settings/quickstart.md` end-to-end locally
- [x] T049 Confirm no live ETA / no agent signing scope creep; DoD review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational** → blocks all stories
- **US1** (branches) first MVP slice
- **US2** after Foundational (can parallelize with late US1 once Branch currency FK exists)
- **US3** after Foundational (encryption); T027 is non-negotiable for secret-at-rest
- **US4** after Foundational
- **US5** after US1–US4 screens exist (or stub hub earlier)
- **Polish** last (T045 isolation after entities exist)

### Recommended sequence

1. Setup + Foundational (schema, RLS, sodium)  
2. US1 branches (MVP)  
3. US2 currencies/rates  
4. US3 ETA credentials **+ T027 ciphertext inspection**  
5. US4 item codes  
6. US5 shell/RBAC polish  
7. Isolation + CI + quickstart  

### Parallel Opportunities

- T002–T004; T008 + T010 + T011 after T007  
- Per story: test tasks `[P]` before/with implementation on different files  
- US2/US4 can proceed in parallel after Foundational if staffing allows  

---

## Parallel Example: User Story 3 (credentials)

```bash
# Dedicated ciphertext inspection first (must fail until encrypt+persist work):
Task: "T027 DEDICATED inspect tenant_eta_credentials row for ciphertext"

# Then parallel:
Task: "T026 ETA API contract tests (masked)"
Task: "T028 Frontend eta smoke"
Task: "T029–T031 service + controller + stub"
```

---

## Implementation Strategy

### MVP

1. Foundational (Prisma + RLS + SecretsEncryptionService)  
2. US1 branch settings  
3. US3 credentials + **T027 passing**  
4. Stop and validate quickstart encryption + isolation skeleton  

### Incremental

US2 currencies → US4 item codes → US5 i18n/RBAC → T045 full isolation + CI  

---

## Notes

- **T027 is non-negotiable** for Principle II / SC-003 — assert DB storage is encrypted, not merely that GET is masked  
- Decrypt only in memory; never log plaintext or ciphertext in audit metadata  
- Manual rates only; `ExchangeRateProvider` is interface + noop  
- Item types: **EGS** and **GS1** only  
- Test Connection = stub until Phase 3  
