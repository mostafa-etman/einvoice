---
description: "Task list for offline sync (PWA/IndexedDB + agent SQLite)"
---

# Tasks: Offline Sync (Agent + Web Drafts)

**Input**: Design documents from `/specs/010-offline-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **005** (document builder / serialization), **006**
(desktop signing agent + `SqliteOfflineQueue`), **007** (submit pipeline +
existing `Idempotency-Key`)

**Tests**: MANDATORY. Explicit gates from user / plan / quickstart:

1. **Duplicate-prevention across resync** — same per-document idempotency key
   resent N times (draft upsert and/or sign→submit handoff) MUST yield exactly
   **one** organization document and exactly **one** submission effect for that
   document version (SC-001 / SC-002 / FR-008 / FR-009).
2. **Offline create → reconnect** — web IndexedDB pending draft syncs to one
   server document after reconnect (US1).
3. **Offline sign → reconnect** — agent `PENDING_UPLOAD` resumes; one signature
   intake + one submit (US2).
4. **Conflict scenario** — overlapping clash → Conflict UI → single converged
   document (US3 / SC-003).
5. **Regression** — 005 golden/parity + CAdES + digest self-check + 007 submit
   integrity remain green (no alternate serializer; signed bytes untouched).

**Out of scope** (do not task): native mobile apps; offline settings/users/bulk
import; requiring PWA install; ETA calls while disconnected; new permission
codes (reuse `documents.view` / `documents.manage`); second agent offline DB.

**Organization**: Phases by user story. Backend + Frontend (+ agent when
touched) before claiming story Done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US5] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Agent**: `apps/agent/`
- **Shared**: `packages/shared/`, `packages/eta-core/`
- **Contracts**: `specs/010-offline-sync/contracts/`
- **Infra**: `infra/` / `apps/api/.env.example` / `apps/web/.env.example`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n keys, permissions confirmation

- [X] T001 Confirm reuse of `documents.view` / `documents.manage` (no new
      permission codes) in `specs/010-offline-sync/contracts/permissions.md` and
      note in `apps/api/.env.example`
- [X] T002 [P] Add sync/backoff env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (`SYNC_BACKOFF_INITIAL_MS`,
      `SYNC_BACKOFF_MAX_MS`)
- [X] T003 [P] Add web offline/sync copy keys to `apps/web/src/messages/en.json`
      and `apps/web/src/messages/ar.json` (`sync.*`, `offline.*`, `conflict.*`)
- [X] T004 [P] Scaffold Nest `SyncModule` shell and register in
      `apps/api/src/app.module.ts` → `apps/api/src/sync/sync.module.ts`
- [X] T005 [P] Add web package dep for IndexedDB wrapper (`idb` or equivalent) in
      `apps/web/package.json`
- [X] T006 [P] Add web API client stubs `apps/web/src/lib/api/sync.ts` per
      `contracts/sync-api.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, idempotency columns, PWA scaffolding, agent queue
audit — **BLOCKS all user stories**

**WARNING**: No story implementation until T007–T014 are green.

- [X] T007 Add Prisma fields `clientIdempotencyKey` (+ unique per tenant) and
      `syncRevision` (or document version strategy) on `Document` in
      `apps/api/prisma/schema.prisma` per `data-model.md`
- [X] T008 Add migration + FORCE RLS review for any new sync/conflict tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T009 [P] Optional `SyncConflict` model (or document ephemeral 409-only
      approach) aligned with `data-model.md` in `apps/api/prisma/schema.prisma`
- [X] T010 [P] PWA manifest + service worker registration scaffolding under
      `apps/web/public/` and `apps/web/src/` (install optional; SW enables
      offline shell)
- [X] T011 [P] IndexedDB draft-queue module skeleton
      `apps/web/src/lib/offline/draft-queue.ts` (tenant-partitioned store API)
- [X] T012 [P] Document agent baseline: inventory `SqliteOfflineQueue` +
      `SigningWorker` resume points in
      `apps/agent/src/Einvoice.Agent/Queue/SqliteOfflineQueue.cs` and
      `apps/agent/src/Einvoice.Agent/Workers/SigningWorker.cs` (no second DB)
- [X] T013 [P] **Contract stub**: Idempotency-Key required on draft sync in
      `apps/api/test/sync.idempotency-header.spec.ts`
- [X] T014 **BLOCKING REGRESSION**: re-run 005 golden + CAdES +
      `cades-digest` + `submission.payload-integrity` and record pass before
      story coding

**Checkpoint**: Foundation ready — US1–US5 may proceed (respect story deps)

---

## Phase 3: User Story 1 - Web offline drafts (Priority: P1) 🎯 MVP

**Goal**: PWA + IndexedDB draft queue; sync engine with backoff; idempotent
draft upsert; pending→synced status for web drafts.

**Independent Test**: Go offline after login → create draft → restart tab →
go online → exactly one server document for that idempotency key.

### Tests for User Story 1 (REQUIRED)

- [X] T015 [P] [US1] Unit: IndexedDB queue persist/reload in
      `apps/web/src/lib/offline/draft-queue.spec.ts`
- [X] T016 [P] [US1] Unit: sync engine backoff schedule in
      `apps/web/src/lib/offline/sync-engine.spec.ts`
- [X] T017 [P] [US1] Integration: `PUT /sync/drafts` creates then returns same
      id on replay in `apps/api/test/sync.draft-upsert.spec.ts`
- [X] T018 [P] [US1] **Duplicate-prevention across resync (drafts)**: same
      `Idempotency-Key` upserted N≥5 times → exactly one `Document` row for
      tenant in `apps/api/test/sync.duplicate-prevention-resync.spec.ts`
- [X] T019 [P] [US1] Web smoke: offline/pending labels in
      `apps/web/src/app/[locale]/(app)/sync/sync.smoke.test.tsx`

### Implementation for User Story 1

- [X] T020 [P] [US1] Implement `PUT /sync/drafts` idempotent upsert +
      `If-Match-Revision` handling in `apps/api/src/sync/sync.controller.ts` /
      `sync.service.ts` per `contracts/sync-api.yaml`
- [X] T021 [US1] Wire documents create/update to persist
      `clientIdempotencyKey` / `syncRevision` in
      `apps/api/src/documents/documents.service.ts`
- [X] T022 [US1] Audit sync success/failure/idempotent-replay in
      `apps/api/src/sync/sync.service.ts`
- [X] T023 [P] [US1] Complete IndexedDB draft queue CRUD + tenant partition in
      `apps/web/src/lib/offline/draft-queue.ts`
- [X] T024 [US1] Implement sync engine (online detect, drain, backoff, statuses)
      in `apps/web/src/lib/offline/sync-engine.ts`
- [X] T025 [US1] Hook document editor create/save to enqueue offline when API
      unreachable in `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx`
      (and/or documents list new flow)
- [X] T026 [US1] Wire `apps/web/src/lib/api/sync.ts` + send `Idempotency-Key`
      header on every draft sync

**Checkpoint**: US1 Done — offline draft survives restart and resyncs once

---

## Phase 4: User Story 2 - Agent SQLite offline signed outcomes (Priority: P1)

**Goal**: Reuse SQLite queue; resume `PENDING_UPLOAD` on reconnect; idempotent
signature intake + submit (no duplicate submissions).

**Independent Test**: Sign while API down → restore → one intake + one submit;
force N resync retries → still one effect.

### Tests for User Story 2 (REQUIRED)

- [X] T027 [P] [US2] Unit/integration: queue retains `SignedJson` across failed
      upload in `apps/agent/tests/Einvoice.Agent.Tests/OfflineQueueResumeTests.cs`
- [X] T028 [P] [US2] **Duplicate-prevention across resync (sign→submit)**: replay
      completed upload/submit with same document+version idempotency key N≥5
      times → one signature completion + one submission in
      `apps/api/test/sync.duplicate-prevention-resync.spec.ts` (extend suite) and/or
      `apps/api/test/submission.idempotent-resync.spec.ts`
- [X] T029 [P] [US2] Contract: agent sends Idempotency-Key on intake/submit per
      `contracts/agent-offline-resume.md` in
      `apps/agent/tests/Einvoice.Agent.Tests/OfflineIdempotencyHeaderTests.cs`
- [X] T030 [P] [US2] Regression gate task note: CAdES + digest still green after
      agent header changes (run commands in quickstart §4)

### Implementation for User Story 2

- [X] T031 [US2] Harden `SigningWorker` resume/backoff for `PENDING_UPLOAD` in
      `apps/agent/src/Einvoice.Agent/Workers/SigningWorker.cs`
- [X] T032 [US2] Emit stable Idempotency-Key (`DocumentId`+`DocumentVersion`) on
      signature complete + submit handoff HTTP in agent API client
      (`apps/agent/src/Einvoice.Agent/Channel/AgentApiClient.cs` or equivalent)
- [X] T033 [US2] Confirm/extend API submission path to honor client key replay
      without second ETA POST in `apps/api/src/submissions/submissions.service.ts`
- [X] T034 [US2] Audit idempotent signature/submit replay events in
      `apps/api/src/submissions/` / signing intake path
- [X] T035 [US2] Agent desktop status text for pending upload / offline in
      `apps/agent/src/Einvoice.Agent.Desktop/` (existing status surface)

**Checkpoint**: US2 Done — offline sign never duplicates on resync

---

## Phase 5: User Story 3 - Conflict resolution + Conflict UI (Priority: P1)

**Goal**: Last-write for non-clashes; dedicated Conflict UI for overlapping
clashes (keep local / keep server / merge).

**Independent Test**: Divergent overlapping edits → conflict status → resolve in
UI → one converged document.

### Tests for User Story 3 (REQUIRED)

- [X] T036 [P] [US3] Unit: clash classifier (overlap vs last-write) in
      `apps/api/src/sync/conflict-classify.spec.ts`
- [X] T037 [P] [US3] Integration: `PUT /sync/drafts` returns 409 + conflict
      payload in `apps/api/test/sync.conflict.spec.ts`
- [X] T038 [P] [US3] Integration: resolve KEEP_LOCAL / KEEP_SERVER / MERGED in
      `apps/api/test/sync.conflict-resolve.spec.ts`
- [X] T039 [P] [US3] Web smoke: Conflict UI labels in
      `apps/web/src/app/[locale]/(app)/sync/conflict.smoke.test.tsx`

### Implementation for User Story 3

- [X] T040 [P] [US3] Implement clash detection using `If-Match-Revision` +
      overlapping paths in `apps/api/src/sync/conflict-classify.ts`
- [X] T041 [US3] Implement `POST /sync/conflicts/:id/resolve` in
      `apps/api/src/sync/sync.controller.ts` / `sync.service.ts`
- [X] T042 [US3] Audit conflict open/resolve in sync service
- [X] T043 [US3] Conflict UI (keep local / server / merge) in
      `apps/web/src/app/[locale]/(app)/sync/conflict/page.tsx` (or modal
      component under `apps/web/src/components/sync/`)
- [X] T044 [US3] Sync engine maps 409 → `conflict` status and opens Conflict UI
      from `apps/web/src/lib/offline/sync-engine.ts`

**Checkpoint**: US3 Done — no silent overwrite on clashes

---

## Phase 6: User Story 4 - Sync status visibility (Priority: P2)

**Goal**: Clear pending/syncing/synced/conflict/failed indicators on web (+
agent pending count); ar/en + RTL.

**Independent Test**: Create pending + conflict items; indicators/counts update
in en and ar; clear after resolve/sync.

### Tests for User Story 4 (REQUIRED)

- [X] T045 [P] [US4] Web smoke: status labels + nav/panel copy en/ar in
      `apps/web/src/app/[locale]/(app)/sync/sync-status.smoke.test.tsx`
- [X] T046 [P] [US4] Unit: summary counts from queue statuses in
      `apps/web/src/lib/offline/sync-status.spec.ts`

### Implementation for User Story 4

- [X] T047 [P] [US4] Sync status panel/badge in shell
      `apps/web/src/components/shell/app-shell.tsx` +
      `apps/web/src/app/[locale]/(app)/sync/page.tsx`
- [X] T048 [US4] Offline/disconnected indicator distinct from synced in sync
      panel + document editor chrome
- [X] T049 [US4] Complete ar/en strings for all sync/conflict states in
      `apps/web/src/messages/en.json` / `ar.json`
- [X] T050 [US4] Agent pending-upload count remains visible / accurate after
      resume changes in desktop status UI

**Checkpoint**: US4 Done — users can read sync health at a glance

---

## Phase 7: User Story 5 - Queue durability / no data loss (Priority: P1)

**Goal**: Pending items survive restart; warn before discarding unsynced queue.

**Independent Test**: Create pending items → restart client → queue intact;
logout/clear-queue path shows warning when unsynced exist.

### Tests for User Story 5 (REQUIRED)

- [X] T051 [P] [US5] Unit/integration: queue survives simulated restart
      (re-open IndexedDB) in `apps/web/src/lib/offline/draft-queue.durability.spec.ts`
- [X] T052 [P] [US5] Web smoke: discard warning copy in
      `apps/web/src/app/[locale]/(app)/sync/durability.smoke.test.tsx`

### Implementation for User Story 5

- [X] T053 [US5] Warn on logout / clear-queue / org-switch when unsynced items
      exist in `apps/web/src/lib/auth-provider.tsx` (or session logout path) +
      sync panel actions
- [X] T054 [US5] Tenant switch quarantines/isolates IndexedDB partition without
      cross-tenant bleed in `apps/web/src/lib/offline/draft-queue.ts`
- [X] T055 [US5] Agent: confirm SQLite file path persists across process restart
      (`AgentSettings.QueueDatabasePath`) — document + assert in
      `apps/agent/tests/Einvoice.Agent.Tests/OfflineQueueResumeTests.cs`

**Checkpoint**: US5 Done — no silent queue loss on supported paths

---

## Phase 8: Polish & Cross-Cutting

- [X] T056 [P] Update `specs/010-offline-sync/quickstart.md` with exact commands
      that pass locally
- [X] T057 [P] Env examples documented for backoff in `apps/api/.env.example` and
      web notes if any
- [X] T058 Security review: IndexedDB never holds ETA secrets/PINs; TLS online;
      tenant partition verified
- [X] T059 [P] RLS review on document idempotency unique + any SyncConflict table
      in `apps/api/prisma/rls.sql`
- [X] T060 Run full quickstart.md validation (web offline, agent resume,
      conflict UI)
- [X] T061 **Final duplicate-prevention gate**: re-run
      `sync.duplicate-prevention-resync.spec.ts` (draft + submit) N-replay
      assertions green
- [X] T062 **Final regression**: 005 golden + parity + CAdES + digest + submit
      integrity green
- [X] T063 Definition of Done review (API + web PWA + agent resume; no second
      agent DB) before merge

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** → **Phase 2** → stories
- **US1 (MVP)** first (draft offline + draft duplicate-prevention)
- **US2** after foundational agent inventory (can follow US1; needs API
  idempotency from T020/T033)
- **US3** after US1 sync upsert exists (409 path)
- **US4** after US1 statuses exist (can parallelize UI copy earlier)
- **US5** after US1 queue exists
- **Phase 8** after targeted stories Done

### User story dependency graph

```text
Phase 1-2 Foundation
    └── US1 Web drafts + draft resync dedupe (MVP)
          ├── US3 Conflict UI
          ├── US4 Status visibility
          └── US5 Durability warnings
    └── US2 Agent resume + submit resync dedupe
          └── (shares T061/T062 polish gates)
```

### Parallel opportunities

- T002/T003/T005/T006 after T001
- T015–T019 tests in parallel before T020–T026
- T027–T029 in parallel before T031–T035
- T036–T039 in parallel before T040–T044
- T056/T057/T059 polish in parallel

### Suggested MVP

**US1 only** (T001–T026): offline drafts + **draft duplicate-prevention resync
test (T018)** green. Then US2 for signing path dedupe (T028).

---

## Implementation Strategy

1. Foundation (schema, PWA shell, IndexedDB skeleton, regression baseline)
2. MVP US1 — IndexedDB + sync engine + idempotent `PUT /sync/drafts` + T018
3. US2 — agent resume + Idempotency-Key + T028 submit dedupe
4. US3 — Conflict UI
5. US4/US5 — status + durability
6. Polish — quickstart + T061 duplicate gate + T062 signing regression

## Task count summary

| Phase | Tasks | Notes |
|-------|-------|-------|
| Setup | T001–T006 | 6 |
| Foundational | T007–T014 | 8 |
| US1 | T015–T026 | 12 (incl. **T018 draft resync dedupe**) |
| US2 | T027–T035 | 9 (incl. **T028 submit resync dedupe**) |
| US3 | T036–T044 | 9 |
| US4 | T045–T050 | 6 |
| US5 | T051–T055 | 5 |
| Polish | T056–T063 | 8 (incl. **T061 final dedupe gate**) |
| **Total** | **T001–T063** | **63** |

Format validation: all tasks use `- [X] Tnnn ...` with file paths; story tasks
include `[USn]`; `[P]` only on parallelizable items.
