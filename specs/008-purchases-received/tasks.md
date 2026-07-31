---
description: "Task list for Purchases (received documents) & purchase returns"
---

# Tasks: Purchases (Received Documents) & Purchase Returns

**Input**: Design documents from `/specs/008-purchases-received/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **004** (ETA auth + credentials), **003** (branches),
**007** research R8/R9 (lifecycle + printout ETA paths — clients may be
implemented here if still missing)

**Tests**: MANDATORY. Explicit gates from plan / user:

1. **Unit** — `classifyReceivedDocument` (`I`→purchase invoice, `C`→purchase
   return, other→OTHER).
2. **Unit** — uuid upsert/dedupe (second sync → zero duplicates; missing uuid
   skipped).
3. **Integration (gated)** — `ETA_SANDBOX_INTEGRATION=1`: **Account B (issuer)
   submits Invoice + Credit Note to Account A (this tenant as receiver)**;
   Account A Sync now pulls both; assert they appear as `PURCHASE_INVOICE` /
   `PURCHASE_RETURN` with stable `documentUuid` and no duplicates on re-sync.
4. **Contract** — Purchases API authz + tenant isolation.
5. **Regression** — 005 golden / parity gates remain green (no signed-byte
   changes in this feature).

**Out of scope** (do not task): PO matching UI/matcher; issuer cancel UI (007
US6); desktop agent changes; overloading issued `Document` rows.

**Organization**: Phases by user story. Backend + Frontend before claiming
story Done. Agent unchanged.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US5] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **eta-core**: `packages/eta-core/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/008-purchases-received/contracts/`
- **Infra**: `infra/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, env, i18n, permissions note

- [x] T001 Confirm reuse of `documents.view` / `documents.manage` for Purchases
      in `specs/008-purchases-received/contracts/permissions.md` and note in
      `apps/api/.env.example` (no new permission codes for MVP)
- [x] T002 [P] Add Purchases sync env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (`PURCHASES_SYNC_ENABLED`,
      `PURCHASES_SYNC_CRON`, `PURCHASES_SYNC_USE_RECENT`, sandbox integration
      flags / issuer+receiver credential placeholders for cross-account test)
- [x] T003 [P] Add Purchases UI copy keys to `apps/web/src/messages/en.json`
      and `apps/web/src/messages/ar.json` (list, filters, Sync now, accept,
      reject, decline, PDF, reconciliation, empty/error states)
- [x] T004 [P] Scaffold Nest `purchases` module and register in
      `apps/api/src/app.module.ts`:
      `apps/api/src/purchases/purchases.module.ts`
- [x] T005 [P] Add web API client stub `apps/web/src/lib/api/purchases.ts` and
      nav entry for Purchases under `apps/web/src/app/[locale]/(app)/` layout /
      nav config

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, eta-core classification, shared ETA clients
(search/recent/details/lifecycle/printout) — **BLOCKS all user stories**

**WARNING**: No Purchases story UI/API work until T006–T016 are green.

- [x] T006 Add Prisma enums + models `ReceivedDocument`,
      `ReceivedDocumentLine`, `ReceivedDocumentSyncRun` (and optional buyer
      decision event if chosen) per `data-model.md` in
      `apps/api/prisma/schema.prisma`
- [x] T007 Extend `DocumentArtifact` with nullable `receivedDocumentId` and
      relation in `apps/api/prisma/schema.prisma`
- [x] T008 Add migration + FORCE RLS + grants for all new tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [x] T009 [P] Implement `classifyReceivedDocument` + direction constant in
      `packages/eta-core/src/received-classify.ts` and export from
      `packages/eta-core/src/index.ts`
- [x] T010 [P] **Unit tests for classification** in
      `packages/eta-core/src/received-classify.spec.ts`
- [x] T011 [P] Implement `EtaDocumentsSearchClient`
      (`GET /api/v1.0/documents/search`, `direction=Received`) in
      `apps/api/src/eta/eta-documents-search.client.ts`
- [x] T012 [P] Implement `EtaDocumentsRecentClient`
      (`GET /api/v1.0/documents/recent`, `direction=Received`) in
      `apps/api/src/eta/eta-documents-recent.client.ts`
- [x] T013 [P] Implement `EtaDocumentDetailsClient` in
      `apps/api/src/eta/eta-document-details.client.ts`
- [x] T014 [P] Implement shared `EtaDocumentLifecycleClient` (state reject +
      decline cancelation / decline rejection) in
      `apps/api/src/eta/eta-document-lifecycle.client.ts` (Phase 6 paths)
- [x] T015 [P] Implement shared `EtaPrintoutClient`
      (`GET /api/v1.0/documents/{uuid}/pdf`) in
      `apps/api/src/eta/eta-printout.client.ts`
- [x] T016 [P] **Unit tests for upsert/dedupe helpers** (missing uuid skip;
      same uuid → update) in
      `apps/api/src/purchases/received-document.upsert.spec.ts`
- [ ] T017 **BLOCKING REGRESSION**: re-run 005 golden / parity gates — MUST
      remain green (no changes to canonical serialize)

**Checkpoint**: Foundation ready — user stories can proceed

---

## Phase 3: User Story 1 - Sync and browse received purchases (Priority: P1) 🎯 MVP

**Goal**: Cron + Sync now pull received docs; upsert by uuid; classify; list +
detail + filters in Purchases UI.

**Independent Test**: Sync now → purchase invoice + purchase return appear
classified; filters work; re-sync creates no duplicates.

### Tests for User Story 1 (REQUIRED)

- [ ] T018 [P] [US1] Contract/API tests for `GET /purchases`,
      `POST /purchases/sync`, `GET /purchases/sync/latest`,
      `GET /purchases/{id}` (authz + tenant isolation) in
      `apps/api/test/purchases.list-sync.spec.ts`
- [ ] T019 [P] [US1] Unit/integration tests for sync service in-flight guard +
      counters in `apps/api/src/purchases/purchases-sync.service.spec.ts`
- [ ] T020 [US1] **Sandbox cross-account integration (gated
      `ETA_SANDBOX_INTEGRATION=1`)**: using **issuer tenant/credentials
      (Account B)** submit at least one Invoice and one Credit Note **to the
      receiver registration of Account A (this tenant)**; as Account A run
      Purchases sync; assert both docs appear with correct
      `PURCHASE_INVOICE` / `PURCHASE_RETURN` classification, non-null
      `documentUuid`, and second sync yields **zero new duplicates** — in
      `apps/api/test/purchases.sandbox-cross-account.spec.ts` (document skip
      conditions if sandbox fixtures unavailable; fail hard on
      misclassification when fixtures present). Document required env
      (`ETA_SANDBOX_ISSUER_*`, `ETA_SANDBOX_RECEIVER_TENANT_ID`, etc.) in
      `apps/api/.env.example` and `specs/008-purchases-received/quickstart.md`
- [x] T021 [P] [US1] Web smoke tests for Purchases labels/nav in
      `apps/web/src/app/[locale]/(app)/purchases/purchases.smoke.test.tsx`

### Implementation for User Story 1

- [x] T022 [US1] Implement upsert mapper + `PurchasesSyncService` (search +
      recent merge, details fetch for new uuids, sync run rows, in-flight
      conflict) in `apps/api/src/purchases/purchases-sync.service.ts` and
      `apps/api/src/purchases/received-document.mapper.ts`
- [x] T023 [US1] Wire Nest cron scheduler for received sync
      (`PURCHASES_SYNC_CRON` / `PURCHASES_SYNC_ENABLED`) in
      `apps/api/src/purchases/purchases-sync.cron.ts` (or schedule provider in
      module)
- [x] T024 [US1] Implement `PurchasesService` list/detail +
      `PurchasesController` endpoints per
      `specs/008-purchases-received/contracts/purchases-api.yaml` in
      `apps/api/src/purchases/purchases.service.ts` and
      `apps/api/src/purchases/purchases.controller.ts`
- [x] T025 [US1] Audit events for sync start/finish (and failures) via
      `apps/api/src/audit/audit.service.ts`
- [x] T026 [US1] Frontend Purchases list page with filters (date, branch,
      type, status) + Sync now + last sync summary in
      `apps/web/src/app/[locale]/(app)/purchases/page.tsx`
- [x] T027 [US1] Frontend Purchases detail page (issuer, lines, taxes,
      statuses, identifiers) in
      `apps/web/src/app/[locale]/(app)/purchases/[id]/page.tsx`
- [x] T028 [US1] Wire `apps/web/src/lib/api/purchases.ts` to real endpoints and
      TanStack Query hooks as used by sibling modules

**Checkpoint**: US1 MVP — sync + browse + sandbox cross-account classification

---

## Phase 4: User Story 2 - Accept or reject a received document (Priority: P1)

**Goal**: Buyer accept (local ± decline cancelation), reject with reason
(ETA state), decline-cancelation when eligible; audit + 409 on terminal
conflicts.

**Independent Test**: Accept and reject on eligible synced docs; duplicate
action → 409; audit shows actor/outcome.

### Tests for User Story 2 (REQUIRED)

- [x] T029 [P] [US2] Contract/API tests for
      `POST /purchases/{id}/accept`, `POST /purchases/{id}/reject`,
      `POST /purchases/{id}/decline-cancelation` in
      `apps/api/test/purchases.buyer-actions.spec.ts`
- [x] T030 [P] [US2] Unit tests for buyer-decision state machine / conflict
      rules in `apps/api/src/purchases/buyer-decision.spec.ts`
- [x] T031 [P] [US2] Frontend smoke/copy tests for accept/reject reason UI in
      `apps/web/src/app/[locale]/(app)/purchases/purchases-actions.smoke.test.tsx`

### Implementation for User Story 2

- [x] T032 [US2] Implement accept / reject / decline-cancelation in
      `apps/api/src/purchases/purchases-buyer-actions.service.ts` using
      `EtaDocumentLifecycleClient`; persist `buyerDecision*` fields; map ETA
      failures to `NEEDS_ATTENTION`
- [x] T033 [US2] Expose routes on `apps/api/src/purchases/purchases.controller.ts`
      with `documents.manage`; audit each action
- [x] T034 [US2] Frontend accept / reject (reason modal) / decline-cancelation
      actions on
      `apps/web/src/app/[locale]/(app)/purchases/[id]/page.tsx` + i18n keys

**Checkpoint**: US1 + US2 independently Done

---

## Phase 5: User Story 3 - Download official PDF printout (Priority: P2)

**Goal**: Fetch ETA PDF by uuid, cache in MinIO, serve
`GET /purchases/{id}/printout`.

**Independent Test**: Download PDF for synced received doc with uuid; second
download served from cache when artifact exists.

### Tests for User Story 3 (REQUIRED)

- [ ] T035 [P] [US3] API tests for printout success / missing uuid / ETA
      failure in `apps/api/test/purchases.printout.spec.ts`
- [ ] T036 [P] [US3] Unit test MinIO key layout for received printouts in
      `apps/api/src/storage/minio-artifact.store.spec.ts` (or purchases
      printout helper spec)

### Implementation for User Story 3

- [x] T037 [US3] Implement printout fetch + MinIO cache +
      `DocumentArtifact` link (`receivedDocumentId`) in
      `apps/api/src/purchases/purchases.service.ts` using
      `EtaPrintoutClient` + `apps/api/src/storage/minio-artifact.store.ts`
- [x] T038 [US3] Add `GET /purchases/{id}/printout` to
      `apps/api/src/purchases/purchases.controller.ts` (`documents.view`)
- [x] T039 [US3] Frontend Download PDF control on detail page
      `apps/web/src/app/[locale]/(app)/purchases/[id]/page.tsx`

**Checkpoint**: US3 Done

---

## Phase 6: User Story 4 - Reconciliation review statuses (Priority: P2)

**Goal**: pending / reconciled / disputed + note; filter; reserved PO link
hook unused; no PO matching UI.

**Independent Test**: Set reconciliation on purchase + return; filter list;
confirm no PO required.

### Tests for User Story 4 (REQUIRED)

- [ ] T040 [P] [US4] API tests for `PATCH /purchases/{id}` reconciliation
      fields in `apps/api/test/purchases.reconciliation.spec.ts`
- [ ] T041 [P] [US4] Assert `purchaseOrderLinkId` remains null and no PO-match
      endpoints exist (contract/negative test) in
      `apps/api/test/purchases.reconciliation.spec.ts`
- [ ] T042 [P] [US4] Frontend smoke for reconciliation controls/copy in
      `apps/web/src/app/[locale]/(app)/purchases/purchases-reconciliation.smoke.test.tsx`

### Implementation for User Story 4

- [x] T043 [US4] Implement patch reconciliation (+ audit) in
      `apps/api/src/purchases/purchases.service.ts` /
      `purchases.controller.ts`
- [x] T044 [US4] Frontend reconciliation status + note + list filter on
      `apps/web/src/app/[locale]/(app)/purchases/page.tsx` and `[id]/page.tsx`
- [x] T045 [US4] Ensure schema/API expose nullable `purchaseOrderLinkId` hook
      only (no PO CRUD) per `data-model.md`

**Checkpoint**: US4 Done — PO matching still out of scope

---

## Phase 7: User Story 5 - Branch-scoped browsing (Priority: P3)

**Goal**: Optional branch assignment + filter including unassigned.

**Independent Test**: Assign branch; filter shows only that branch’s rows.

### Tests for User Story 5 (REQUIRED)

- [ ] T046 [P] [US5] API tests for branch assign + `branchId` /
      `unassignedBranch` filters in
      `apps/api/test/purchases.branch.spec.ts`
- [ ] T047 [P] [US5] Frontend smoke for branch filter/assign copy in
      `apps/web/src/app/[locale]/(app)/purchases/purchases-branch.smoke.test.tsx`

### Implementation for User Story 5

- [ ] T048 [US5] Enforce same-tenant active branch on patch in
      `apps/api/src/purchases/purchases.service.ts`
- [ ] T049 [US5] Frontend branch filter + assign control on list/detail
      `apps/web/src/app/[locale]/(app)/purchases/`

**Checkpoint**: All user stories independently meet Definition of Done

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Docs, security, quickstart, DoD

- [ ] T050 [P] Update `specs/008-purchases-received/quickstart.md` with
      cross-account sandbox steps (issuer B → receiver A) matching T020
- [ ] T051 [P] README / ops note for `PURCHASES_SYNC_*` cron in `README.md` or
      `apps/api/INSTALL`-adjacent docs (only if project already documents
      similar sync jobs — keep minimal)
- [ ] T052 Tenant-isolation review: confirm RLS policies +
      `withTenant` on all purchases queries/jobs
- [ ] T053 Confirm no secrets in logs/responses for lifecycle/printout/sync
      errors; sandbox-first base URL only from env
- [ ] T054 Run full quickstart.md validation checklist
- [ ] T055 Definition of Done review: BE + FE + tests for US1–US5; agent
      untouched; 005 regression still green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Start immediately
- **Foundational (Phase 2)**: After Setup — **BLOCKS** all stories
- **US1 (Phase 3)**: After Foundational — **MVP**
- **US2 (Phase 4)**: After Foundational; needs US1 data for manual test, but
  APIs testable with fixtures
- **US3 (Phase 5)**: After Foundational; needs uuid on received rows (US1)
- **US4 (Phase 6)** / **US5 (Phase 7)**: After Foundational; integrate with
  list/detail from US1
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

| Story | Depends on | Notes |
|-------|------------|-------|
| US1 Sync/browse | Foundation | MVP; includes cross-account sandbox gate |
| US2 Accept/reject | Foundation (+ US1 for E2E) | Shared lifecycle client from T014 |
| US3 PDF | Foundation (+ US1 uuid) | Shared printout client from T015 |
| US4 Reconciliation | Foundation (+ US1 list) | No PO matcher |
| US5 Branch | Foundation (+ US1 list) | Optional assignment |

### Within Each Story

- Tests first (fail before implement)
- Services before controllers
- Backend + frontend before story Done

### Parallel Opportunities

- Phase 1: T002–T005 in parallel
- Phase 2: T009–T016 clients/specs in parallel after schema T006–T008
- US1: T018/T019/T021 in parallel; T026/T027 UI can parallelize after T024
- US2–US5 test tasks marked [P] within each phase

---

## Parallel Example: User Story 1

```bash
# After foundation:
Task: "T018 purchases.list-sync contract tests"
Task: "T019 purchases-sync.service.spec.ts"
Task: "T021 purchases.smoke.test.tsx"

# Then implement sync + API, then:
Task: "T020 sandbox cross-account issuer→receiver classification"
Task: "T026 list UI" + "T027 detail UI"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup  
2. Phase 2 Foundation (clients + schema + classification)  
3. Phase 3 US1 including **T020 cross-account sandbox gate**  
4. **STOP and VALIDATE** Sync now + classified list  
5. Demo Purchases browse

### Incremental Delivery

1. US1 → sync/browse MVP  
2. US2 → accept/reject  
3. US3 → PDF  
4. US4 → reconciliation hooks (no PO match)  
5. US5 → branch filters  
6. Polish + quickstart

### Parallel Team Strategy

- After Foundation: Dev A = US1+T020, Dev B = US2 lifecycle UI/API, Dev C =
  US3 printout — integrate on shared `purchases` module carefully

---

## Notes

- [P] = different files, no incomplete deps
- T020 is the **required sandbox proof**: another ETA account issues to this
  tenant; sync classifies Invoice/Credit correctly
- Do not implement PO matching — only reserved `purchaseOrderLinkId`
- Prefer shared `EtaDocumentLifecycleClient` / `EtaPrintoutClient` so 007
  issuer routes can reuse later
- Commit after each task or logical group
- Stop at checkpoints to validate independently
