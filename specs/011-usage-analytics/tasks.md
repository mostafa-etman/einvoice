---
description: "Task list for usage analytics & metering"
---

# Tasks: Usage Analytics & Metering

**Input**: Design documents from `/specs/011-usage-analytics/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md; features **002** (RBAC), **003** (branches/currencies), **007**
(documents/submissions), **008** (purchases/received), **009** (CSV/XLSX export
patterns)

**Tests**: MANDATORY. Explicit gates from user / plan / quickstart:

1. **Accuracy — dashboard totals vs events** — after known activity and rollup,
   `GET /analytics/summary` (and dashboard cards) MUST equal aggregates computed
   directly from `UsageEvent` rows for the same tenant/filters/period
   (counters = sum; `storage_bytes` = latest gauge). Also MUST equal the known
   issued/received/valid/invalid document fixture counts (SC-002 / quickstart §1).
2. **Tenant isolation** — Tenant B activity never appears in Tenant A summary
   (SC-003).
3. **Export parity** — CSV and XLSX exports match on-screen/API totals for the
   same filters (SC-005 / FR-013).
4. **Permissions** — missing `analytics.view` / `analytics.export` → 403.
5. **No charging UI** — Analytics must not expose invoicing/payment (US5).
6. **Regression** — no agent/serialization changes; existing document/purchase
   flows remain green.

**Out of scope** (do not task): invoicing/payment/plan pricing; hard usage caps
that block work; email-scheduled reports; desktop agent changes; ETA
serialization; Chart.js (use **recharts**); reusing `billing.*` for Analytics
access.

**Organization**: Phases by user story. Backend + Frontend before claiming
story Done. Agent N/A.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US5] for story phases only
- Exact file paths required

## Path Conventions

- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Shared**: `packages/shared/`
- **Contracts**: `specs/011-usage-analytics/contracts/`
- **Infra**: `apps/api/.env.example` / `apps/web/.env.example`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module shells, deps, env, i18n keys, permission codes

- [X] T001 Add `ANALYTICS_VIEW` / `ANALYTICS_EXPORT` to
      `packages/shared/src/permissions.ts` and seed Owner/Admin only per
      `specs/011-usage-analytics/contracts/permissions.md` (update role seed /
      migration helpers as used by 002)
- [X] T002 [P] Add analytics/rollup env keys to `apps/api/.env.example` and
      `apps/api/src/config/env.ts` (e.g. `USAGE_METERING_TIMEZONE`,
      `USAGE_ROLLUP_CRON`, export retention)
- [X] T003 [P] Add `analytics.*` copy keys to `apps/web/src/messages/en.json` and
      `apps/web/src/messages/ar.json`
- [X] T004 [P] Scaffold Nest `AnalyticsModule` shell and register in
      `apps/api/src/app.module.ts` → `apps/api/src/analytics/analytics.module.ts`
- [X] T005 [P] Add web dep `recharts` in `apps/web/package.json`
- [X] T006 [P] Add web API client stubs `apps/web/src/lib/api/analytics.ts` per
      `contracts/analytics-api.yaml`
- [X] T007 [P] Register BullMQ queue names `usage-rollup` and `usage-export` in
      `apps/api/src/queues/queue-names.ts` and wire in
      `apps/api/src/queues/queues.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema + RLS, event append service, rollup jobs, authZ gates —
**BLOCKS all user stories**

**WARNING**: No story implementation until T008–T016 are green.

- [X] T008 Add Prisma models `UsageEvent`, `UsageDailyRollup`,
      `UsageMonthlyRollup`, `UsageExportJob` (+ enums) in
      `apps/api/prisma/schema.prisma` per `data-model.md`
- [X] T009 Create migration + FORCE RLS policies for usage tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql`
- [X] T010 Implement idempotent `UsageEventService.append` in
      `apps/api/src/analytics/usage-event.service.ts` (unique
      `tenantId+meter+idempotencyKey`; no secrets in `metaJson`)
- [X] T011 Implement daily→monthly rollup + rebuild-from-events in
      `apps/api/src/analytics/usage-rollup.service.ts` (counters = sum;
      `storage_bytes` = latest absolute gauge)
- [X] T012 Implement BullMQ processor/cron trigger in
      `apps/api/src/analytics/usage-rollup.processor.ts` (jobs always carry
      `tenantId`)
- [X] T013 [P] Unit tests for rollup math + idempotent append in
      `apps/api/src/analytics/usage-rollup.spec.ts` and
      `apps/api/src/analytics/usage-event.spec.ts`
- [X] T014 [P] Guard helpers / permission checks for `analytics.view` and
      `analytics.export` reusable by controller in
      `apps/api/src/analytics/` (follow existing permission decorator pattern)
- [X] T015 [P] Add Analytics nav entry (permission-gated) in
      `apps/web/src/components/shell/app-shell.tsx` (or existing nav source)
- [X] T016 Scaffold empty Analytics page route
      `apps/web/src/app/[locale]/(app)/analytics/page.tsx` (ar/en layout shell)

**Checkpoint**: Foundation ready — events can append, rollups can run, RLS on

---

## Phase 3: User Story 1 - Analytics dashboard (Priority: P1) 🎯 MVP

**Goal**: Owner/Admin sees organization usage summary + charts with
branch/period/currency filters from daily/monthly rollups.

**Independent Test**: Open `/analytics` with known rollups; filters change
totals/charts; unauthorized user denied; no other-tenant data.

### Tests for User Story 1 (REQUIRED)

> Write tests FIRST; ensure they FAIL before implementation.

- [X] T017 [P] [US1] API contract/integration tests for
      `GET /analytics/summary` and `GET /analytics/series` (authZ, filters,
      tenant header) in `apps/api/test/analytics.summary.spec.ts`
- [X] T018 [P] [US1] **Accuracy test — dashboard/API totals vs actual events**:
      seed known `UsageEvent` rows (and/or emit via fixture); run rollup; assert
      `GET /analytics/summary` totals **exactly equal** aggregates computed from
      raw `UsageEvent` for same tenant/period/filters (sum counters; latest
      `storage_bytes`); also assert equality to known fixture counts for
      `issued`/`received`/`valid`/`invalid` in
      `apps/api/test/analytics.accuracy-vs-events.spec.ts`
- [X] T019 [P] [US1] Cross-tenant isolation assertion in
      `apps/api/test/analytics.isolation.spec.ts`
- [X] T020 [P] [US1] Web smoke: filters + metric cards render (en + ar RTL) in
      `apps/web/src/app/[locale]/(app)/analytics/analytics.smoke.test.tsx`

### Implementation for User Story 1

- [X] T021 [US1] Implement `AnalyticsService` summary + series (read rollups;
      label org-level `api_calls`/`storage_bytes` when branch/currency set) in
      `apps/api/src/analytics/analytics.service.ts`
- [X] T022 [US1] Implement `AnalyticsController` routes per
      `contracts/analytics-api.yaml` in
      `apps/api/src/analytics/analytics.controller.ts`
- [X] T023 [US1] Audit successful analytics view (and denials as applicable) via
      existing audit pipeline from controller/service
- [X] T024 [P] [US1] Build filter bar (branch, period presets/custom range,
      currency) in `apps/web/src/components/analytics/analytics-filters.tsx`
- [X] T025 [P] [US1] Build metric cards + recharts series in
      `apps/web/src/components/analytics/analytics-charts.tsx` and
      `apps/web/src/components/analytics/metric-cards.tsx`
- [X] T026 [US1] Wire TanStack Query + page composition in
      `apps/web/src/app/[locale]/(app)/analytics/page.tsx` using
      `apps/web/src/lib/api/analytics.ts`
- [X] T027 [US1] Empty/zero-state and freshness (`asOf`) UX on Analytics page

**Checkpoint**: US1 MVP — dashboard + **accuracy-vs-events** test green

---

## Phase 4: User Story 2 - Document meter accuracy (Priority: P1)

**Goal**: Emit `issued` / `received` / `valid` / `invalid` from real document
and purchase flows so operational counts match Analytics.

**Independent Test**: Create known mix of issued/received/valid/invalid docs;
rollup; summary matches operational lists and event aggregates.

### Tests for User Story 2 (REQUIRED)

- [X] T028 [P] [US2] Integration: submit/record known document fixture → events
      appended with correct meters/idempotency keys in
      `apps/api/test/analytics.emit-documents.spec.ts`
- [X] T029 [P] [US2] Extend accuracy gate: after document fixture + rollup,
      summary === event aggregates === fixture counts in
      `apps/api/test/analytics.accuracy-vs-events.spec.ts` (or sibling
      `analytics.document-accuracy.spec.ts`)
- [X] T030 [P] [US2] Outcome-change scenario (invalid→valid) does not invent
      duplicate documents in rollups — unit/integration in
      `apps/api/src/analytics/usage-outcome.spec.ts`

### Implementation for User Story 2

- [X] T031 [US2] Emit hooks for outbound `issued` / `valid` / `invalid` from
      documents/submissions lifecycle in
      `apps/api/src/analytics/usage-emit.hooks.ts` (+ call sites in
      `apps/api/src/documents/` / `apps/api/src/submissions/` as appropriate)
- [X] T032 [US2] Emit hooks for `received` from purchases flow in
      `apps/api/src/analytics/usage-emit.hooks.ts` (+
      `apps/api/src/purchases/`)
- [X] T033 [US2] Ensure branchId + currencyCode dimensions set on document
      events when known
- [X] T034 [US2] Confirm dashboard filters for branch/currency still pass
      accuracy-vs-events assertions

**Checkpoint**: US2 — live document activity drives accurate meters

---

## Phase 5: User Story 3 - api_calls & storage_bytes (Priority: P1)

**Goal**: Meter authenticated API calls and absolute storage gauge per tenant.

**Independent Test**: Generate API traffic + store artifacts; summary shows
expected `api_calls` / `storage_bytes`; other tenant unaffected.

### Tests for User Story 3 (REQUIRED)

- [X] T035 [P] [US3] Integration: authenticated requests increment `api_calls`
      events (idempotent / countable) in
      `apps/api/test/analytics.api-calls.spec.ts`
- [X] T036 [P] [US3] Integration: storage snapshot events set absolute
      `storage_bytes`; rollup = latest gauge in
      `apps/api/test/analytics.storage-bytes.spec.ts`
- [X] T037 [P] [US3] Accuracy-vs-events includes `api_calls` and
      `storage_bytes` in `apps/api/test/analytics.accuracy-vs-events.spec.ts`

### Implementation for User Story 3

- [X] T038 [US3] API call emitter (interceptor/middleware; skip health/public)
      wiring into Nest pipeline from `apps/api/src/analytics/`
- [X] T039 [US3] Storage absolute-gauge emitter on artifact store/delete and/or
      scheduled refresh via `apps/api/src/analytics/usage-emit.hooks.ts` +
      `apps/api/src/storage/`
- [X] T040 [US3] Dashboard cards/labels for `api_calls` and `storage_bytes`
      (human-readable bytes) in
      `apps/web/src/components/analytics/metric-cards.tsx`
- [X] T041 [US3] UI note when branch/currency filters do not split org-level
      meters

**Checkpoint**: US3 — all six meters visible and tested

---

## Phase 6: User Story 4 - Export CSV/XLSX (Priority: P2)

**Goal**: Authorized users export usage for current filters as CSV or XLSX.

**Independent Test**: Export both formats; file totals match summary for same
filters; denied without `analytics.export`.

### Tests for User Story 4 (REQUIRED)

- [X] T042 [P] [US4] API tests: create export CSV + XLSX, download when READY,
      403 without permission in `apps/api/test/analytics.export.spec.ts`
- [X] T043 [P] [US4] Assert export row/totals match `GET /analytics/summary`
      (and event aggregates) for same filters in
      `apps/api/test/analytics.export.spec.ts`
- [X] T044 [P] [US4] Web smoke: export control chooses CSV/XLSX in
      `apps/web/src/app/[locale]/(app)/analytics/analytics.export.smoke.test.tsx`

### Implementation for User Story 4

- [X] T045 [US4] Implement `UsageExportService` (CSV + XLSX writers; MinIO
      artifact under tenant prefix) in
      `apps/api/src/analytics/usage-export.service.ts`
- [X] T046 [US4] BullMQ `usage-export` processor + controller routes
      `POST/GET /analytics/exports` and download in
      `apps/api/src/analytics/analytics.controller.ts` /
      `usage-rollup.processor.ts` (or dedicated export processor file)
- [X] T047 [US4] Audit export create + download
- [X] T048 [US4] Web export UI + download handling in
      `apps/web/src/components/analytics/analytics-export.tsx` wired on
      `apps/web/src/app/[locale]/(app)/analytics/page.tsx`

**Checkpoint**: US4 — both export formats match dashboard

---

## Phase 7: User Story 5 - Billing-ready facts, no charging (Priority: P2)

**Goal**: Durable event log + daily/monthly rollups suitable for future
billing; no invoice/payment UI.

**Independent Test**: After activity, events + daily + monthly rollups exist for
all six meters; rebuild rollup from events restores same values; Analytics has
no charging flows.

### Tests for User Story 5 (REQUIRED)

- [X] T049 [P] [US5] Rebuild test: delete/recompute daily+monthly from events →
      identical values in `apps/api/test/analytics.rollup-rebuild.spec.ts`
- [X] T050 [P] [US5] Assert no billing/charge endpoints or UI routes introduced
      (smoke/grep or route test) in
      `apps/web/src/app/[locale]/(app)/analytics/analytics.smoke.test.tsx`
      and/or API module scan test

### Implementation for User Story 5

- [X] T051 [US5] Expose/document rebuild entrypoint used by jobs in
      `apps/api/src/analytics/usage-rollup.service.ts` (idempotent upsert)
- [X] T052 [US5] Ensure monthly derived from daily per research in rollup
      service
- [X] T053 [US5] Quickstart checklist alignment notes in
      `specs/011-usage-analytics/quickstart.md` if any gaps found during
      implementation (keep validation steps current)

**Checkpoint**: US5 — billing-ready data path without charging product surface

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Hardening across stories

- [X] T054 [P] Run and fix full analytics test suite
      (`pnpm --filter api test -- analytics` and web analytics smokes)
- [X] T055 [P] RLS review for usage tables + MinIO prefix check for export
      artifacts
- [X] T056 Confirm secrets never appear in events/exports/logs (spot-check
      fixtures)
- [X] T057 Performance sanity: summary/series for typical range within ~3s
      target (manual or light bench note)
- [X] T058 Execute `specs/011-usage-analytics/quickstart.md` scenarios
      end-to-end
- [X] T059 Definition of Done review (BE + FE + tests; agent untouched;
      constitution gates)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all stories
- **US1 (Phase 3)**: After Foundational — MVP dashboard + **accuracy-vs-events**
- **US2 (Phase 4)**: After US1 API exists (emit → accuracy against live docs);
  can overlap FE polish with US1 if staffed carefully
- **US3 (Phase 5)**: After event/rollup foundation; can parallelize with US2
  (different emitters)
- **US4 (Phase 6)**: After summary API stable (needs totals to match export)
- **US5 (Phase 7)**: After rollups exist; rebuild tests after T011
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

| Story | Depends on | Independently testable? |
|-------|------------|-------------------------|
| US1 Dashboard | Foundation | Yes — seed events/rollups without live doc emits |
| US2 Doc meters | Foundation + summary API | Yes — fixture docs → events → summary |
| US3 API/storage | Foundation + summary API | Yes — isolated emitters |
| US4 Export | Summary API | Yes — export vs summary |
| US5 Billing-ready | Rollup service | Yes — rebuild without UI charging |

### Within Each Story

- Tests MUST be written and FAIL before implementation
- Emitters before claiming live accuracy
- Backend + frontend for story before Done
- **Accuracy-vs-events (T018/T029/T037)** is the primary correctness gate

### Parallel Opportunities

- T002–T007 (setup) in parallel after T001 starts
- T013–T016 in parallel after schema/RLS (T008–T009)
- T017–T020 (US1 tests) in parallel
- T024–T025 (US1 UI pieces) in parallel after API client ready
- US2 and US3 emitters (T031–T032 vs T038–T039) in parallel after foundation
- T042–T044 (US4 tests) in parallel

---

## Parallel Example: User Story 1

```bash
# Tests in parallel:
Task: "T017 analytics.summary.spec.ts"
Task: "T018 analytics.accuracy-vs-events.spec.ts  # totals vs UsageEvent"
Task: "T019 analytics.isolation.spec.ts"
Task: "T020 analytics.smoke.test.tsx"

# UI pieces in parallel after T021–T022:
Task: "T024 analytics-filters.tsx"
Task: "T025 analytics-charts.tsx + metric-cards.tsx"
```

---

## Parallel Example: US2 + US3 emitters

```bash
Task: "T031–T033 document/purchase emit hooks"
Task: "T038–T039 api_calls + storage_bytes emitters"
# Then extend T029/T037 accuracy-vs-events coverage
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup  
2. Phase 2 Foundational (events + rollups + RLS)  
3. Phase 3 US1 — dashboard + **T018 accuracy-vs-events**  
4. **STOP and VALIDATE** before emitters/export  

### Incremental Delivery

1. Setup + Foundational → metering core  
2. US1 → demo dashboard (seeded events) + accuracy gate  
3. US2 → real document meters  
4. US3 → api_calls + storage_bytes  
5. US4 → CSV/XLSX export  
6. US5 → rebuild/billing-ready confirmation  
7. Polish + quickstart  

### Parallel Team Strategy

1. Team finishes Setup + Foundational together  
2. Dev A: US1 API + accuracy test  
3. Dev B: US1 web (recharts)  
4. Then Dev A: US2 emits; Dev B: US3 emits; Dev C: US4 export  

---

## Notes

- [P] = different files, no incomplete deps  
- Exact-match integers only for counter accuracy (no fuzzy totals)  
- `storage_bytes` = absolute gauge (latest in bucket)  
- Do not reuse `billing.view` for Analytics  
- Commit after each task or logical group  
- Stop at checkpoints to validate independently  
