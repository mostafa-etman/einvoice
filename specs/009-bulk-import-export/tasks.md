---
description: "Task list for bulk import/export (CSV/XLSX + ETA packages)"
---

# Tasks: Bulk Import / Export

**Input**: Design documents from `/specs/009-bulk-import-export/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **005** (document builder), **006** (signing agent /
sign queue), **007** (submit/poll pipeline + MinIO artifacts)

**Tests**: MANDATORY. Explicit gates called out by the user / plan / clarify:

1. **Mixed-row import** — fixture with **dozens of rows** including bad rows →
   only valid rows create documents / enqueue sign+submit; error report lists
   all invalid rows (SC-002).
2. **Large-file import (streaming)** — CSV and/or XLSX with **≥2,000** data
   rows within configured limits validates without loading the entire file into
   memory at once; progress/completion surfaced (SC-005a / FR-002a).
3. **Package export round-trip (gated)** — Request Document Package → poll
   **Get Package Requests** until ready → Get Document Package zip stored in
   MinIO (`ETA_SANDBOX_INTEGRATION=1`) (SC-005 / FR-012/FR-013).
4. **Regression** — 005 golden/parity + 007 submit integrity remain green; import
   must not introduce a bulk-only serializer.

**Out of scope** (do not task): watched-folder/cron pickup; `.xls`; ERP connectors;
received/purchase bulk import; new desktop agent features; new permission codes
(reuse `documents.view` / `documents.manage`).

**Organization**: Phases by user story. Backend + Frontend before claiming
story Done (agent code unchanged; reuse existing `sign` / `submit` queues).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US6] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/009-bulk-import-export/contracts/`
- **Infra**: `infra/` / `apps/api/.env.example`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n keys, permissions confirmation

- [X] T001 Confirm reuse of `documents.view` / `documents.manage` for import/
      export in `specs/009-bulk-import-export/contracts/permissions.md` and note
      in `apps/api/.env.example` (no new permission codes)
- [X] T002 [P] Add import/export env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (`IMPORT_MAX_BYTES`, `IMPORT_MAX_ROWS`,
      `EXPORT_ARTIFACT_TTL_DAYS`, `PACKAGE_POLL_INITIAL_MS`,
      `PACKAGE_POLL_MAX_MS`, `PACKAGE_STALL_HOURS`)
- [X] T003 [P] Add Import Wizard + Export Center copy keys to
      `apps/web/src/messages/en.json` and `apps/web/src/messages/ar.json`
      (`imports.*`, `exports.*`)
- [X] T004 [P] Scaffold Nest modules and register in `apps/api/src/app.module.ts`:
      `apps/api/src/imports/imports.module.ts`,
      `apps/api/src/exports/exports.module.ts`
- [X] T005 [P] Add API package deps `papaparse` (+ `@types/papaparse`) and
      `xlsx` in `apps/api/package.json`
- [X] T006 [P] Add web API client stubs `apps/web/src/lib/api/imports.ts` and
      `apps/web/src/lib/api/exports.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, queues, MinIO kinds, ETA package client skeleton —
**BLOCKS all user stories**

**WARNING**: No import/export story work until T007–T014 are green.

- [X] T007 Add Prisma models `ImportJob`, `ImportRowResult`, `ExportJob`,
      `EtaPackageRequest` (+ enums) and optional `Document.importJobId` /
      `importRowNumber` in `apps/api/prisma/schema.prisma` per
      `specs/009-bulk-import-export/data-model.md`
- [X] T008 Add migration + FORCE RLS + grants for all new tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T009 [P] Extend BullMQ queue names `import` / `export` / `package-poll`
      (+ job data types with `tenantId`) in `apps/api/src/queues/queue-names.ts`
      and wire workers in `apps/api/src/queues/`
- [X] T010 [P] Extend MinIO artifact kinds/helpers for
      `imports` / `exports` / `packages` in
      `apps/api/src/storage/minio-artifact.store.ts`
- [X] T011 [P] Scaffold ETA package HTTP client stubs in
      `apps/api/src/eta/eta-document-package.client.ts` (Request / Get Package
      Requests / Get Document Package) using `etaFetch` + `EtaService` token
- [X] T012 [P] Unit test: reject `.xls` / unsupported MIME at upload boundary in
      `apps/api/src/imports/import-parse.service.spec.ts` (fail until parser
      exists)
- [X] T013 [P] **Tenant isolation contract stub** for import/export job access in
      `apps/api/test/import-export.tenant-isolation.spec.ts`
- [X] T014 **BLOCKING REGRESSION**: re-run 005 parity + 007 payload-integrity /
      submit gates — MUST remain green before story implementation merges

**Checkpoint**: Foundation ready — user stories can proceed

---

## Phase 3: User Story 1 - Template + Import Wizard + valid-rows create (Priority: P1) 🎯 MVP

**Goal**: Download CSV/XLSX templates; upload → map → stream-validate → error
report; create documents from **valid rows only**; optional
`CREATE_SIGN_SUBMIT` enqueues existing `sign` jobs.

**Independent Test**: Template download + mixed valid/invalid file → only valid
docs created; error report lists bad rows; Create only leaves docs unsigned.

### Tests for User Story 1 (REQUIRED)

> Write these FIRST; ensure they FAIL before implementation.

- [X] T015 [P] [US1] Unit: CSV streaming parse emits rows incrementally in
      `apps/api/src/imports/import-parse.service.spec.ts`
- [X] T016 [P] [US1] Unit: XLSX parse + `.xls` rejection in
      `apps/api/src/imports/import-parse.service.spec.ts`
- [X] T017 [P] [US1] Unit: row validation classifier (valid vs field errors) in
      `apps/api/src/imports/import-validate.service.spec.ts`
- [X] T018 [P] [US1] **Integration — mixed dozens of rows**: fixture with ≥30
      rows including bad rows → run `CREATE_ONLY` → assert only valid
      `documentId`s created and error report covers every invalid row in
      `apps/api/test/import.mixed-rows.spec.ts`
- [X] T019 [P] [US1] **Integration — large-file streaming import (≥2,000 rows)**:
      generate CSV (and XLSX if feasible) with ≥2000 data rows within
      `IMPORT_MAX_*`; assert validation completes, job reaches `VALIDATED`, and
      parse path does not buffer the entire file as one in-memory string/array
      (stream/chunk assertions or spy on incremental row callbacks) in
      `apps/api/test/import.large-file-stream.spec.ts`
- [X] T020 [P] [US1] Integration: `CREATE_SIGN_SUBMIT` enqueues `sign` jobs only
      for created (valid) documents in
      `apps/api/test/import.sign-enqueue.spec.ts` (mock queue)
- [X] T021 [P] [US1] Web smoke: Import Wizard labels/steps in
      `apps/web/src/app/[locale]/(app)/imports/imports.smoke.test.tsx`

### Implementation for User Story 1

- [X] T022 [P] [US1] Implement CSV/XLSX template generator +
      `GET /imports/templates/{documentType}` in
      `apps/api/src/imports/imports.controller.ts` and
      `apps/api/src/imports/imports.service.ts`
- [X] T023 [P] [US1] Implement streaming parse service
      `apps/api/src/imports/import-parse.service.ts` (papaparse stream + xlsx)
- [X] T024 [P] [US1] Implement row validation + error report writer in
      `apps/api/src/imports/import-validate.service.ts` and
      `apps/api/src/imports/import-error-report.service.ts` (MinIO CSV)
- [X] T025 [US1] Implement mapping + document create via existing documents
      builder in `apps/api/src/imports/import-map.service.ts` and run path in
      `apps/api/src/imports/imports.service.ts` (valid rows only; set
      `importJobId` / row number on Document)
- [X] T026 [US1] Implement BullMQ `import` worker (validate + run + optional
      sign enqueue) in `apps/api/src/queues/` and wire
      `POST /imports/jobs`, `PUT .../mapping`, `POST .../validate`,
      `POST .../run`, `GET .../error-report`, `GET .../rows` per
      `contracts/imports-exports-api.yaml`
- [X] T027 [US1] Audit events for validate / run / sign-submit handoff in
      import services (actor, tenant, counts; no secrets)
- [X] T028 [US1] Frontend Import Wizard (upload → mapping → validation report →
      run) in `apps/web/src/components/imports/` and pages
      `apps/web/src/app/[locale]/(app)/imports/page.tsx`,
      `apps/web/src/app/[locale]/(app)/imports/[jobId]/page.tsx`
- [X] T029 [US1] Wire `apps/web/src/lib/api/imports.ts` + nav link; ar/en + RTL

**Checkpoint**: US1 MVP Done — mixed-row + **large-file stream** tests green;
Create only works end-to-end in UI

---

## Phase 4: User Story 2 - Column mapping + re-validate (Priority: P1)

**Goal**: Editable column mapping; block validate/run when required fields
unmapped; remapping replaces prior error report.

**Independent Test**: Renamed-header CSV → map → validate OK; unmap required
field → validate blocked with clear message; re-validate refreshes report.

### Tests for User Story 2 (REQUIRED)

- [X] T030 [P] [US2] Unit: auto-match + required-field coverage in
      `apps/api/src/imports/import-map.service.spec.ts`
- [X] T031 [P] [US2] Integration: put mapping → validate → change mapping →
      validate replaces error report artifact in
      `apps/api/test/import.mapping-revalidate.spec.ts`
- [X] T032 [P] [US2] Web smoke: mapping step shows unmapped required fields in
      `apps/web/src/components/imports/import-mapping.smoke.test.tsx`

### Implementation for User Story 2

- [X] T033 [P] [US2] Complete mapping API validation (reject incomplete required
      map with 400) in `apps/api/src/imports/imports.controller.ts` /
      `imports.service.ts`
- [X] T034 [US2] Frontend mapping UI (source→target selects, required indicators,
      re-validate CTA) in `apps/web/src/components/imports/`
- [X] T035 [US2] Ensure validate job deletes/replaces prior MinIO error report
      key before writing new one in
      `apps/api/src/imports/import-error-report.service.ts`

**Checkpoint**: US2 independently testable with renamed headers

---

## Phase 5: User Story 3 - Local Export Center (CSV/XLSX/PDF/JSON) (Priority: P1)

**Goal**: Create local multi-format export jobs; track status; download
artifacts; multi-doc PDF as zip of PDFs with inventory.

**Independent Test**: Filter known docs → CSV+JSON ready → download matches
filter; empty filter fails clearly; no cross-tenant rows.

### Tests for User Story 3 (REQUIRED)

- [X] T036 [P] [US3] Unit: CSV/XLSX/JSON exporters emit expected columns in
      `apps/api/src/exports/local-exporters/*.spec.ts`
- [X] T037 [P] [US3] Integration: local export job READY + download CSV/JSON in
      `apps/api/test/export.local.spec.ts`
- [X] T038 [P] [US3] Integration: PDF multi-doc produces zip + inventory; partial
      PDF failures listed without failing whole job unnecessarily in
      `apps/api/test/export.local-pdf-zip.spec.ts`
- [X] T039 [P] [US3] Web smoke: Export Center create/track labels in
      `apps/web/src/app/[locale]/(app)/exports/exports.smoke.test.tsx`

### Implementation for User Story 3

- [X] T040 [P] [US3] Implement local exporters in
      `apps/api/src/exports/local-exporters/` (csv.ts, xlsx.ts, json.ts, pdf.ts)
- [X] T041 [US3] Implement `exports.service.ts` + BullMQ `export` worker +
      `POST /exports/local`, `GET /exports/jobs/{id}`,
      `GET /exports/jobs/{id}/download` in
      `apps/api/src/exports/exports.controller.ts`
- [X] T042 [US3] Audit local export create/download; enforce
      `EXPORT_ARTIFACT_TTL_DAYS` → 410 when expired
- [X] T043 [US3] Frontend Export Center local tab/flow in
      `apps/web/src/app/[locale]/(app)/exports/page.tsx` and
      `apps/web/src/app/[locale]/(app)/exports/[jobId]/page.tsx`; wire
      `apps/web/src/lib/api/exports.ts`

**Checkpoint**: Local export usable without ETA package APIs

---

## Phase 6: User Story 4 - ETA document package request/download (Priority: P2)

**Goal**: Request Document Package; track via **Get Package Requests** until
ready; Get Document Package zip → MinIO; webhook accelerates poll only.

**Independent Test**: Sandbox package round-trip downloadable from Export
Center; status never webhook-only.

### Tests for User Story 4 (REQUIRED)

- [X] T044 [P] [US4] Unit: map ETA package status codes 1–4 → local enum in
      `apps/api/src/exports/eta-package.service.spec.ts`
- [X] T045 [P] [US4] Unit: package-poll backoff / stall cutoff in
      `apps/api/src/exports/eta-package.service.spec.ts`
- [X] T046 [P] [US4] **Integration — package export round-trip (sandbox gated)**:
      `ETA_SANDBOX_INTEGRATION=1` → Request → poll Get Package Requests until
      complete → Get Document Package 200 zip → assert MinIO object under
      `tenants/{tenantId}/artifacts/packages/` and ExportJob `READY` in
      `apps/api/test/export.package-roundtrip.spec.ts`
- [X] T047 [P] [US4] Contract: package-ready notification enqueues immediate
      Get Package Requests check (not download-without-poll) in
      `apps/api/test/export.package-webhook-accelerate.spec.ts`
- [X] T048 [P] [US4] Web smoke: ETA package request form + status in
      `apps/web/src/app/[locale]/(app)/exports/exports-package.smoke.test.tsx`

### Implementation for User Story 4

- [X] T049 [P] [US4] Implement full `EtaDocumentPackageClient` in
      `apps/api/src/eta/eta-document-package.client.ts` per
      `contracts/eta-document-packages.md`
- [X] T050 [US4] Implement `eta-package.service.ts` + BullMQ `package-poll`
      worker (canonical Get Package Requests; Get zip on ready; MinIO put)
- [X] T051 [US4] Wire `POST /exports/packages` + job detail `etaPackage` payload
      in `apps/api/src/exports/exports.controller.ts` /
      `exports.service.ts`
- [X] T052 [US4] Hook 007 package-ready webhook path to accelerate
      `package-poll` for matching `etaRequestId` (do not skip Get Package
      Requests) in `apps/api/src/webhooks/` (or exports bridge)
- [X] T053 [US4] Audit package request / ready / download; Frontend ETA package
      UI in Export Center + optional document deep-link query params

**Checkpoint**: **Package round-trip** test green under sandbox gate

---

## Phase 7: User Story 5 - Import/Export job history (Priority: P2)

**Goal**: History lists for imports and exports; re-download error reports and
artifacts while not expired; clear expiry messaging.

**Independent Test**: After one import + one export, reopen history and
re-download both artifacts.

### Tests for User Story 5 (REQUIRED)

- [X] T054 [P] [US5] Integration: list import jobs + re-download error report in
      `apps/api/test/import.history.spec.ts`
- [X] T055 [P] [US5] Integration: list export jobs + 410 after forced expiry in
      `apps/api/test/export.history-expiry.spec.ts`
- [X] T056 [P] [US5] Web smoke: history tables render counts/status in
      `apps/web/src/app/[locale]/(app)/imports/imports-history.smoke.test.tsx`
      and exports history counterpart

### Implementation for User Story 5

- [X] T057 [P] [US5] Complete list endpoints pagination/filters on
      `GET /imports/jobs` and `GET /exports/jobs` in controllers/services
- [X] T058 [US5] Frontend history tables on imports/exports index pages with
      download actions and expired-state copy (ar/en)
- [X] T059 [US5] Audit download attempts (success/expired)

**Checkpoint**: Ops can self-serve past jobs without re-running blindly

---

## Phase 8: User Story 6 - Branch + permission-aware bulk ops (Priority: P3)

**Goal**: Branch assignment on import; export respects document visibility /
branch; Viewer cannot run import/export.

**Independent Test**: Branch-limited import lands on allowed branch; Viewer
denied manage endpoints; export omits out-of-scope docs.

### Tests for User Story 6 (REQUIRED)

- [X] T060 [P] [US6] Integration: Viewer 403 on `POST /imports/jobs` and
      `POST /exports/local` in `apps/api/test/import-export.permissions.spec.ts`
- [X] T061 [P] [US6] Integration: import with branchId / per-row branch column
      in `apps/api/test/import.branch.spec.ts`
- [X] T062 [P] [US6] Integration: export filters by branch visibility in
      `apps/api/test/export.branch-visibility.spec.ts`

### Implementation for User Story 6

- [X] T063 [P] [US6] Enforce permission guards on all import/export routes
      (`documents.view` vs `documents.manage`) in controllers
- [X] T064 [US6] Apply branch default + per-row branch mapping in
      `import-map.service.ts`; filter local export queries by permitted branches
- [X] T065 [US6] Frontend: hide run/upload CTAs for view-only; branch selectors
      on wizard + export filters

**Checkpoint**: Multi-branch + least privilege verified

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Quickstart validation, regression, docs, hardening

- [X] T066 [P] Update `specs/009-bulk-import-export/quickstart.md` with exact
      commands for mixed-row, **large-file**, and **package round-trip** tests
- [X] T067 [P] Confirm no hardcoded ETA hosts/paths outside `ETA_API_BASE_URL`
      usage in `apps/api/src/eta/eta-document-package.client.ts`
- [X] T068 Security review: uploads scanned for size/MIME; MinIO keys
      tenant-prefixed; error reports contain no secrets — checklist in
      `specs/009-bulk-import-export/checklists/` or PR notes
- [X] T069 [P] RLS review: FORCE RLS on Import*/Export*/EtaPackage* tables in
      `apps/api/prisma/rls.sql`
- [X] T070 Run full quickstart.md validation locally (wizard + Export Center
      ar/en)
- [X] T071 **Final regression**: 005 parity + 007 submit integrity + new import
      mixed-row + **large-file stream** + gated **package round-trip** (when
      credentials available)
- [X] T072 Definition of Done review (BE + FE + tests; agent unchanged) before
      next feature phase

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all stories
- **US1 (Phase 3)**: After Foundational — **MVP**
- **US2 (Phase 4)**: After Foundational; naturally follows US1 mapping surfaces
  but independently testable
- **US3 (Phase 5)**: After Foundational; parallelizable with US1/US2 if staffed
- **US4 (Phase 6)**: After Foundational; ideally after US3 Export Center shell
  exists (can share FE page)
- **US5 (Phase 7)**: After US1 + US3 (history needs jobs to exist)
- **US6 (Phase 8)**: After US1 + US3 permissioned routes exist
- **Polish (Phase 9)**: After desired stories complete

### User Story Dependencies

| Story | Can start after | Depends on other stories? |
|-------|-----------------|---------------------------|
| US1 Import Wizard | Phase 2 | No (MVP) |
| US2 Mapping | Phase 2 | Soft: shares US1 APIs |
| US3 Local export | Phase 2 | No |
| US4 ETA packages | Phase 2 | Soft: US3 Export Center UI |
| US5 History | US1 + US3 | Yes (data) |
| US6 Branch/perms | US1 + US3 | Soft |

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Services before controllers/workers
- Backend + frontend + tests before Done
- US1 must include **large-file stream** test green
- US4 must include **package round-trip** test green (gated)

### Parallel Opportunities

- Phase 1: T002–T006 in parallel
- Phase 2: T009–T013 in parallel after T007/T008 schema
- After Phase 2: US1 and US3 can proceed in parallel (different modules)
- US1 tests T015–T021 in parallel
- US4 tests T044–T048 in parallel once client stubs exist

---

## Parallel Example: User Story 1

```bash
# Launch US1 tests together (expect FAIL pre-impl):
Task: "T018 mixed dozens of rows in apps/api/test/import.mixed-rows.spec.ts"
Task: "T019 large-file streaming ≥2000 rows in apps/api/test/import.large-file-stream.spec.ts"
Task: "T020 sign enqueue only for valid rows in apps/api/test/import.sign-enqueue.spec.ts"
Task: "T021 Import Wizard smoke in apps/web/.../imports.smoke.test.tsx"

# Then implement parser + validate + run in parallel where files differ:
Task: "T023 import-parse.service.ts"
Task: "T024 import-validate + error-report services"
```

## Parallel Example: User Story 4

```bash
Task: "T044/T045 eta-package unit tests"
Task: "T046 package round-trip sandbox gated in apps/api/test/export.package-roundtrip.spec.ts"
Task: "T047 webhook accelerate contract test"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup
2. Phase 2 Foundational (CRITICAL)
3. Phase 3 US1 including **mixed-row** + **large-file stream** tests
4. **STOP and VALIDATE** via quickstart §1
5. Demo Import Wizard Create only

### Incremental Delivery

1. US1 MVP → demo
2. US2 mapping polish
3. US3 local Export Center
4. US4 **package round-trip** (sandbox)
5. US5 history + US6 branch/perms
6. Polish + final regression

### Parallel Team Strategy

- Dev A: US1 (+ US2)
- Dev B: US3 (+ US4 package client/poll)
- Dev C: Web wizard + Export Center i18n
- After US1+US3: US5/US6

---

## Notes

- [P] = different files, no incomplete deps
- [USn] required on story-phase tasks only
- Agent: **no code changes** — only enqueue existing `sign` queue
- Do not accept `.xls`; do not all-or-nothing block valid rows
- Get Package Requests is canonical; webhook is accelerator only
- Commit after each task or logical group
- Stop at checkpoints to validate independently
