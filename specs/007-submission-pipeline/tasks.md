---
description: "Task list for submission pipeline (batch + async results)"
---

# Tasks: Submission Pipeline (Batch + Async Results)

**Input**: Design documents from `/specs/007-submission-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **004** (ETA auth), **005** (documents + signed
payloads), **006** (signing → `SIGNED` docs ready to submit)

**Tests**: MANDATORY. Explicit gates called out by the user / plan:

1. **Unit — recursive auto-split** on `MaximumSizeExceeded` (halving; zero
   lost/duplicated docs).
2. **Unit — Retry-After** on `422 DuplicateSubmission` (+ 403 no-retry).
3. **Integration (gated)** — sandbox submit of a batch of **≥3** signed invoices
   → poll to terminal (`ETA_SANDBOX_INTEGRATION=1`).
4. **Regression** — 005 locked golden + cross-runtime parity + 006 CAdES software
   gate remain green; submitted bytes === stored signed payload.

**Out of scope** (do not task): receiver Decline / inbound reject (Purchases);
scheduled bulk auto-submit (Bulk Import); hardware token signing verification
(006 `HARDWARE_SIGNING_PENDING`).

**Organization**: Phases by user story. Backend + Frontend before claiming
story Done (agent code unchanged; enqueue hook from signing intake only).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US7] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/007-submission-pipeline/contracts/`
- **Infra**: `infra/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n keys, permissions note

- [ ] T001 Document reuse of `documents.view` / `documents.manage` for
      submission lifecycle in `specs/007-submission-pipeline/contracts/permissions.md`
      (already drafted — confirm ROLE matrix needs no change) and note in
      `apps/api/.env.example`
- [ ] T002 [P] Add submission env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (`ETA_SUBMIT_MAX_DOCS`, `ETA_SUBMIT_MAX_BYTES`,
      `ETA_POLL_INITIAL_MS`, `ETA_POLL_MAX_MS`, `ETA_POLL_STALL_HOURS`,
      `MINIO_BUCKET`, webhook PSK placeholders)
- [ ] T003 [P] Add Submissions UI copy keys to `apps/web/src/messages/en.json`
      and `apps/web/src/messages/ar.json`
- [ ] T004 [P] Scaffold Nest modules and register in `apps/api/src/app.module.ts`:
      `apps/api/src/submissions/submissions.module.ts`,
      `apps/api/src/queues/queues.module.ts`,
      `apps/api/src/webhooks/webhooks.module.ts`,
      `apps/api/src/storage/storage.module.ts`
- [ ] T005 [P] Add API package deps (`bullmq`, `@nestjs/bullmq`, MinIO client)
      in `apps/api/package.json` and wire Redis connection options in
      `apps/api/src/queues/queues.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, status enum, ETA status map, BullMQ skeleton, MinIO
client, signed-byte integrity gate — **BLOCKS all user stories**

**WARNING**: No submit/poll/webhook story work until T010–T014 are green.

- [X] T006 Extend `DocumentStatus` enum and Document ETA snapshot fields
      (`needsAttention`, `etaStatus`, `etaUuid`, `etaLongId`, `submissionUuid`,
      `etaStatusRaw`, `etaStatusUpdatedAt`) in `apps/api/prisma/schema.prisma`
      per `data-model.md`
- [X] T007 Add Prisma models `Submission`, `SubmissionDocument`,
      `DocumentFilingLock`, `DocumentStatusEvent`, `AuthorityNotification`,
      `DocumentArtifact`, `SubmissionTriggerSetting` in
      `apps/api/prisma/schema.prisma`
- [X] T008 Add migration + FORCE RLS + grants for all new tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T009 [P] Implement single ETA→local mapper in
      `apps/api/src/eta/eta-status-map.ts` (Valid/Invalid/Cancelled/Rejected +
      intake refused stays SIGNED)
- [X] T010 [P] **Unit tests for eta-status-map** in
      `apps/api/src/eta/eta-status-map.spec.ts`
- [X] T011 [P] Implement MinIO artifact store wrapper in
      `apps/api/src/storage/minio-artifact.store.ts` (tenant-prefixed keys)
- [X] T012 Implement BullMQ queue names `sign` / `submit` / `poll` + worker
      stubs (tenantId on every job) in `apps/api/src/queues/`
- [X] T013 [P] **Signed-byte + internalID integrity test** (FR-008-integrity):
      assert assembled submit payload documents equal stored `etaPayloadJson`
      (no re-canonicalize) **and** every `documents[].internalID ===` DB
      `Document.internalId`; mismatch fails before POST — in
      `apps/api/test/submission.payload-integrity.spec.ts`
- [X] T014 **BLOCKING REGRESSION**: re-run 005 parity + 006 CAdES/canonical/
      strip gates (`node tools/parity-canonical/run.mjs` and agent
      `dotnet test … --filter Cades|CanonicalSerialize|StripSignatures`) —
      MUST remain green

**Checkpoint**: Foundation ready — user stories can proceed

---

## Phase 3: User Story 1 - Submit signed documents in batches (Priority: P1) 🎯 MVP

**Goal**: User (or agent-signed enqueue) submits ≥1 SIGNED docs; system posts
multi-doc batch to ETA; stores `submissionUUID` + per-doc ids; intake refusals
leave doc SIGNED.

**Independent Test**: Submit 2+ signed docs → Submission row with ETA reference;
accepted docs `SUBMITTED`; refused-at-intake stay `SIGNED` with error detail.

### Tests for User Story 1 (REQUIRED)

- [ ] T015 [P] [US1] API contract tests for `POST /submissions`,
      `POST /documents/:id/submit`, Idempotency-Key replay in
      `apps/api/test/submission.create.spec.ts`
- [ ] T016 [P] [US1] Tenant isolation tests for submissions in
      `apps/api/test/submission.isolation.spec.ts`
- [ ] T017 [P] [US1] **Unit — recursive auto-split (MaximumSizeExceeded)**:
      halving produces child batches, zero docs lost/duplicated, ceiling
      lowered — in `apps/api/src/submissions/batch-split.spec.ts`
      (or `apps/api/test/batch-split.spec.ts`)
- [X] T017a [P] [US1] **BLOCKING Unit — mixed 202 result map** (closes analyze
      I1–I8): mocked HTTP 202 with **2 accepted + 1 rejected**; assert
      join-by-`internalId` only (never array index), `etaUuid`/`etaLongId`
      assigned **only** to accepted, refused stays `SIGNED` with
      `intakeErrorJson` and **no** `DocumentFilingLock`, Submission state
      `PARTIALLY_ACCEPTED`, poll enqueued for accepted only — in
      `apps/api/test/submission.202-result-map.spec.ts`
- [ ] T018 [P] [US1] **Integration (gated) — sandbox batch ≥3 invoices**: when
      `ETA_SANDBOX_INTEGRATION=1`, submit ≥3 signed docs to ETA sandbox, assert
      HTTP 202 shape (`submissionUUID`, accepted/rejected arrays), persist ids
      via internalId join, in `apps/api/test/submission.sandbox.spec.ts`;
      **skipped** when flag unset

### Implementation for User Story 1

- [ ] T019 [P] [US1] Implement `EtaSubmitClient` (`POST /api/v1.0/documentsubmissions/`)
      in `apps/api/src/eta/eta-submit.client.ts`
- [ ] T020 [P] [US1] Implement batch assembler + recursive split helper;
      create exactly one `SubmissionDocument` per doc **before** POST with
      `internalId` set; verify `documents[].internalID ===` DB `internalId`
      (FR-008-integrity) in `apps/api/src/submissions/batch-assembler.ts` and
      `apps/api/src/submissions/batch-split.ts`
- [ ] T021 [US1] Implement `SubmissionsService` create/submit with batch
      idempotency; implement `apply202ResultMap` joining **only** by
      `(tenantId, internalId)` (FR-004a); create `DocumentFilingLock` **only on
      acceptance** (FR-004b / FR-046) — never on refuse — in
      `apps/api/src/submissions/submissions.service.ts` and
      `apps/api/src/submissions/submission-202-result-map.ts`
      (**partial**: `submission-202-result-map.ts` + T017a green; service/HTTP
      wiring still open)
- [ ] T022 [US1] Implement `SubmissionsController` + document submit route per
      `contracts/submissions-api.yaml` in
      `apps/api/src/submissions/submissions.controller.ts` (and documents
      controller hooks as needed)
- [ ] T023 [US1] Implement `submit` BullMQ worker: assemble → integrity check →
      ETA POST → apply 202 map (FR-004a/b/c/d) → set
      `PARTIALLY_ACCEPTED`/`SENT`/all-reject state → enqueue poll **for ACCEPTED
      only** (FR-008e) in `apps/api/src/queues/submit.processor.ts`
- [ ] T024 [US1] On signature intake success, enqueue submit when FR-040 applies
      in `apps/api/src/signing/signing.service.ts` (or intake path)
- [ ] T025 [US1] Persist `SubmissionTriggerSetting` read/write +
      auto-submit-on-create default OFF in
      `apps/api/src/submissions/submission-settings.service.ts`
- [ ] T026 [US1] Audit submit triggered/created/accepted/refused in
      `apps/api/src/submissions/submissions.service.ts` via `AuditService`
- [ ] T027 [US1] Web: Submit / Submit batch actions on document list/detail in
      `apps/web/src/app/[locale]/(app)/documents/` and API client
      `apps/web/src/lib/api/submissions.ts`
- [ ] T028 [US1] Status-event writer helper used on every local status change in
      `apps/api/src/submissions/document-status-events.service.ts`

**Checkpoint**: US1 DoD — batch submit works; **T017a mixed-202 map green**
(blocking); T017 auto-split unit green; T018 sandbox ≥3 skipped-or-green.
Do **not** treat submit persistence as Done until T017a passes.

---

## Phase 4: User Story 2 - Poll until validation outcome (Priority: P2)

**Goal**: Poll submission/document details with exponential backoff until
VALID/INVALID; stop on terminal; stall at 24h.

**Independent Test**: After 202, without webhooks, docs reach VALID or INVALID
with errors stored; terminal docs stop polling.

### Tests for User Story 2 (REQUIRED)

- [ ] T029 [P] [US2] Unit tests for poll backoff schedule (5s→2m cap) and stall
      cutoff in `apps/api/src/queues/poll-backoff.spec.ts`
- [ ] T030 [P] [US2] Integration test (mocked ETA): poll applies mapper +
      validation errors + status events in
      `apps/api/test/submission.poll.spec.ts`

### Implementation for User Story 2

- [ ] T031 [P] [US2] Implement `EtaSubmissionStatusClient` (get submission /
      document details) in `apps/api/src/eta/eta-submission-status.client.ts`
- [ ] T032 [US2] Implement `poll` BullMQ processor with backoff, terminal stop,
      24h needsAttention in `apps/api/src/queues/poll.processor.ts`
- [ ] T033 [US2] Apply status updates only via `eta-status-map` + status events;
      store raw ETA snapshot fields on Document
- [ ] T034 [US2] Wire submit worker to enqueue initial poll job after 202 **for
      ACCEPTED documents only** (FR-008e); never poll REFUSED_AT_INTAKE rows

**Checkpoint**: US2 DoD — outcomes visible without webhooks

---

## Phase 5: User Story 3 - Error recovery (size / Retry-After / 403 / retry) (Priority: P2)

**Goal**: Auto-split on size; honor Retry-After; classify 403; user retry of
unresolved docs only; INVALID → new version path.

**Independent Test**: Force each error class; documented reaction occurs;
retry never re-sends VALID docs.

### Tests for User Story 3 (REQUIRED)

- [ ] T035 [P] [US3] **Unit — Retry-After / 403 classification**: DuplicateSubmission
      delays ≥ header; IncorrectSubmitter/Forbidden set needsAttention with no
      auto-retry — in `apps/api/src/submissions/eta-error-classifier.spec.ts`
- [ ] T036 [P] [US3] API tests for `POST /submissions/:id/retry` (only unresolved)
      in `apps/api/test/submission.retry.spec.ts`
- [ ] T037 [P] [US3] Extend auto-split coverage: single oversize doc → needs
      attention (no infinite loop) in `apps/api/src/submissions/batch-split.spec.ts`

### Implementation for User Story 3

- [ ] T038 [P] [US3] Implement ETA error classifier + Retry-After parsing in
      `apps/api/src/submissions/eta-error-classifier.ts`
- [ ] T039 [US3] Wire MaximumSizeExceeded → `batch-split` + lower effective
      ceiling in `submit.processor.ts`
- [ ] T040 [US3] Wire DuplicateSubmission / 429 / 503 backoff into BullMQ job
      delay; 403 → needsAttention in `submit.processor.ts`
- [ ] T041 [US3] Implement retry endpoint + service (skip VALID; new idempotency
      keys) in `submissions.controller.ts` / `submissions.service.ts`
- [ ] T042 [US3] INVALID correction path: bump version, clear filing lock rules
      per FR-018a–c (document service hooks) in
      `apps/api/src/documents/documents.service.ts`
- [ ] T043 [US3] Per-tenant submit pacing / rate lock via Redis in
      `apps/api/src/queues/tenant-rate-limiter.ts`
- [ ] T044 [US3] Web: Retry action on submission/document detail in
      `apps/web/src/app/[locale]/(app)/submissions/`

**Checkpoint**: US3 DoD — T017 + T035 + T037 green; recovery paths covered

---

## Phase 6: User Story 4 - Submission dashboard (Priority: P2)

**Goal**: Bilingual dashboard with filters, counts, multi-select submit, error
drilldown; manage-gated actions.

**Independent Test**: Mixed statuses filterable; Invalid drilldown shows ETA
errors; Viewer cannot submit/retry/cancel.

### Tests for User Story 4 (REQUIRED)

- [ ] T045 [P] [US4] API list/filter contract tests in
      `apps/api/test/submission.list.spec.ts`
- [ ] T046 [P] [US4] Web smoke/RTL tests for submissions page in
      `apps/web/src/app/[locale]/(app)/submissions/submissions.smoke.test.tsx`

### Implementation for User Story 4

- [ ] T047 [US4] Implement list/detail APIs per contract in
      `submissions.controller.ts` / `submissions.service.ts`
- [ ] T048 [US4] Web dashboard page + filters in
      `apps/web/src/app/[locale]/(app)/submissions/page.tsx`
- [ ] T049 [US4] Web submission detail + per-document error drilldown in
      `apps/web/src/app/[locale]/(app)/submissions/[id]/page.tsx`
- [ ] T050 [US4] Nav link + permission-gated actions (hide manage for Viewer) in
      web layout/nav and page components
- [ ] T051 [US4] Multi-select Submit batch UX wired to `POST /submissions` with
      Idempotency-Key in dashboard

**Checkpoint**: US4 DoD — ar/en dashboard usable

---

## Phase 7: User Story 5 - Webhook notifications (Priority: P3)

**Goal**: Ping + document + package-ready callbacks; verify ApiKey; enqueue
immediate poll; idempotent deliveryId.

**Independent Test**: Valid ping echoes RIN; bad key 401; duplicate deliveryId
no double-update; poll still works with zero webhooks.

### Tests for User Story 5 (REQUIRED)

- [ ] T052 [P] [US5] Webhook auth + ping + idempotent delivery tests in
      `apps/api/test/webhooks.eta.spec.ts`
- [ ] T053 [P] [US5] Assert webhook alone does not set VALID without poll
      confirmation in `apps/api/test/webhooks.eta.spec.ts`

### Implementation for User Story 5

- [ ] T054 [P] [US5] Encrypted webhook PSK storage/settings hooks (tenant) in
      `apps/api/src/webhooks/webhook-credentials.service.ts`
- [ ] T055 [US5] Implement `PUT /eta-callbacks/ping`,
      `/notifications/documents`, `/notifications/documentpackages` per
      `contracts/eta-webhooks.md` in `apps/api/src/webhooks/eta-callbacks.controller.ts`
- [ ] T056 [US5] Persist `AuthorityNotification` + enqueue short-circuit poll in
      `apps/api/src/webhooks/eta-callbacks.service.ts`
- [ ] T057 [US5] Audit notification received/rejected; never log PSK

**Checkpoint**: US5 DoD — webhooks optional accelerator only

---

## Phase 8: User Story 6 - Cancel / Reject issued documents (Priority: P3)

**Goal**: Issuer cancel/reject with reason; refuse outside window; no inbound
Decline UI.

**Independent Test**: Cancel VALID inside window → CANCELLED; outside window
unchanged; no receiver Decline actions exposed.

### Tests for User Story 6 (REQUIRED)

- [ ] T058 [P] [US6] API tests cancel/reject success, window refusal, RBAC in
      `apps/api/test/document.lifecycle.spec.ts`
- [ ] T059 [P] [US6] Assert no inbound decline endpoints exist / return 404 in
      `apps/api/test/document.lifecycle.spec.ts`

### Implementation for User Story 6

- [ ] T060 [P] [US6] Implement `EtaDocumentLifecycleClient` (cancel/reject) in
      `apps/api/src/eta/eta-document-lifecycle.client.ts`
- [ ] T061 [US6] Implement `POST /documents/:id/cancel` and `/reject` in
      documents/submissions controllers + service; map to local status + events
- [ ] T062 [US6] Web cancel/reject dialogs with reason on document/submission
      detail (manage only)
- [ ] T063 [US6] Audit cancel/reject with actor, reason, outcome

**Checkpoint**: US6 DoD — issuer-only lifecycle

---

## Phase 9: User Story 7 - PDF printout (Priority: P3)

**Goal**: Download ETA PDF for VALID docs; cache in MinIO; deny cross-tenant.

**Independent Test**: VALID → PDF; non-VALID refused; second download from
MinIO; other tenant 403/404.

### Tests for User Story 7 (REQUIRED)

- [ ] T064 [P] [US7] Printout API tests (VALID only, cache hit, isolation) in
      `apps/api/test/document.printout.spec.ts`

### Implementation for User Story 7

- [ ] T065 [P] [US7] Implement `EtaPrintoutClient`
      (`GET /api/v1.0/documents/{uuid}/pdf`) in
      `apps/api/src/eta/eta-printout.client.ts`
- [ ] T066 [US7] Implement printout service + `GET /documents/:id/printout`
      storing `DocumentArtifact` via MinIO
- [ ] T067 [US7] Optional: package-ready webhook → record packageId for later
      download in webhook service
- [ ] T068 [US7] Web PDF download button on VALID documents
- [ ] T069 [US7] Audit printout downloaded

**Checkpoint**: US7 DoD — PDF path complete

---

## Phase 10: Polish & Cross-Cutting

- [ ] T070 [P] Operational counts / needs-attention metrics endpoint or logging
      hooks per FR-037 in `apps/api/src/submissions/submissions-metrics.ts`
- [ ] T071 [P] Ensure secrets never appear in logs (PSK, tokens) — review
      webhook + ETA clients; add negative log assertion tests if practical
- [ ] T072 Run full quickstart checklist in
      `specs/007-submission-pipeline/quickstart.md` (unit split + Retry-After +
      gated sandbox ≥3 + e2e create→sign→submit→poll→Valid)
- [ ] T073 [P] CI: default job runs unit/contract tests; sandbox job optional
      / manual with `ETA_SANDBOX_INTEGRATION=1` in `.github/workflows/ci.yml`
- [ ] T074 Final regression: T013 payload integrity + T014 parity/CAdES gates

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 → Phase 2 → US1 (MVP) → US2 → US3 → US4 → US5 / US6 / US7 (US5–7
  largely parallel after US2) → Polish

### User story dependencies

- **US1**: Foundation only — MVP
- **US2**: Needs US1 submit→enqueue poll
- **US3**: Needs US1 assembler + US2 status model; extends split/Retry-After
- **US4**: Needs US1–US2 data; can start UI earlier against mocks
- **US5**: Needs US2 poll short-circuit hook
- **US6 / US7**: Need VALID/terminal docs from US2; parallelizable with US5

### Parallel opportunities

- Within Phase 1: T002–T005
- Within Phase 2: T009–T011, T013
- US1 tests T015–T018 in parallel before/with impl
- US5–US7 after US2 can proceed in parallel streams

### Suggested MVP

**Phase 1 + 2 + US1** including **T017 auto-split unit** and **T018 sandbox ≥3
integration (gated)**. Then US2 for real outcomes, then US3/US4 for recovery +
dashboard.

---

## Implementation Strategy

1. Complete Setup + Foundational (stop if T013/T014 fail).
2. US1 batch submit — prove multi-doc 202 + **T017a internalId result map** +
   idempotency + **auto-split unit** + **sandbox ≥3 when credentials available**.
   **Do not implement submit persistence without T017a green.**
3. US2 poll backoff to VALID/INVALID.
4. US3 error classifier + retry + INVALID versioning.
5. US4 dashboard.
6. US5 webhooks, US6 lifecycle, US7 PDF (parallel where possible).
7. Polish + CI gating.

### Blocking test gates (non-negotiable)

| Gate | Path | Assertion | Blocks |
|------|------|-----------|--------|
| T017a | `submission.202-result-map.spec.ts` | Join by internalId; mixed accept/reject paths; lock only on accept; poll accepted only | **US1 submit persistence** |
| T017 | `batch-split.spec.ts` | Recursive halve; 0 lost/dup | US1 merge |
| T035 | `eta-error-classifier.spec.ts` | Retry-After + 403 no-retry | US3 merge |
| T018 | `submission.sandbox.spec.ts` | ≥3 docs sandbox 202→ids via internalId (gated) | Live ETA confidence |
| T013 | `submission.payload-integrity.spec.ts` | submitted === signed bytes + internalID match | Merge |
| T014 | parity + CAdES | 005/006 gates green | Merge |

---

## Notes

- Digest/signing unchanged — never re-canonicalize for submit.
- Decline / inbound reject: do not implement (FR-043).
- `sign` queue is enqueue bridge only; CAdES stays on agent (006).
- Mark tasks `[X]` only when tests for that story pass.
