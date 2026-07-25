---
description: "Task list for document building, validation & ETA canonical serialization"
---

# Tasks: Document Building, Validation & ETA Canonical Serialization

**Input**: Design documents from `/specs/005-document-building-serialization/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md, golden-vectors/; features **003** (settings) and **004** (cached
document type versions)

**Tests**: MANDATORY. Golden `canonicalSerialize` tests for every **locked**
`*.canonical.txt` (currently **gv-01**; promote PENDING as confirmed) are a
**blocking gate** in Phase 2 — no user-story work until they pass byte-exact.
Agent consumes the **same** files. gv-02..gv-08 remain PENDING until
EInvoicingSigner `CanonicalString.txt` confirmation (see runbook).

**Organization**: Phases by user story. Backend + frontend (+ agent serialize
parity) before claiming story Done. No ETA submission/signing in scope.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable (different files, no incomplete deps)
- **[Story]**: [US1]…[US6] for story phases only
- Exact file paths required

## Path Conventions

- **eta-core**: `packages/eta-core/`
- **API**: `apps/api/`
- **Web**: `apps/web/`
- **Agent**: `apps/agent/`
- **Vectors**: `specs/005-document-building-serialization/golden-vectors/`
- **Contracts**: `specs/005-document-building-serialization/contracts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Permissions, i18n, package deps, module shells

- [X] T001 Add `documents.view` and `documents.manage` to
      `packages/shared/src/permissions.ts` and update `ROLE_PERMISSION_MATRIX`
      (Owner/Admin/Accountant manage; Viewer view) per
      `contracts/permissions.md`
- [X] T002 [P] Add documents authoring / validation / preview copy keys to
      `apps/web/src/messages/ar.json` and `apps/web/src/messages/en.json`
- [X] T003 [P] Add decimal math dependency (e.g. `decimal.js`) to
      `packages/eta-core/package.json` and wire workspace build so
      `@einvoice/eta-core` is consumable by `apps/api` and (optionally)
      `apps/web`
- [X] T004 [P] Scaffold `apps/api/src/documents/documents.module.ts` and register
      in `apps/api/src/app.module.ts` (empty controllers/providers OK)
- [X] T005 [P] Confirm golden vector files exist and are documented in
      `specs/005-document-building-serialization/golden-vectors/README.md`
      (gv-01 locked official; gv-02..gv-08 PENDING candidates;
      RUNBOOK-bassemAgmi.md; `packages/eta-core/docs/reference-algorithm.md`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Document persistence shell, money helpers, **`canonicalSerialize`**,
and the **blocking golden suite** — **BLOCKS all user stories**

**⚠️ CRITICAL**: No user story work until this phase completes — especially
until the golden canonical-serialization gate (T012 / T013) is green.

- [X] T006 Create Prisma models `Document`, `DocumentLine`, `DocumentLineTax`
      (decimal-string money fields, status, version, ETA binding fields) in
      `apps/api/prisma/schema.prisma` per `data-model.md`
- [X] T007 Add migration + FORCE RLS policies for document tables in
      `apps/api/prisma/migrations/` and `apps/api/prisma/rls.sql` (or equivalent
      RLS migration pattern used in 002/003)
- [X] T008 [P] Implement decimal-string money helpers (`formatMoney` 2 dp half
      away from zero; add/sub/mul) in `packages/eta-core/src/money.ts`
- [X] T009 [P] Unit tests for money helpers in
      `packages/eta-core/src/money.spec.ts` (midpoint rounding, `0.00` formatting)
- [X] T010 Implement `canonicalSerialize(document)` per
      `packages/eta-core/docs/reference-algorithm.md` (bassemAgmi SerializeToken:
      recursive, `ToUpper` names, as-is non-string scalars, `JsonConvert.ToString`
      string escaping, empty array → name once, null → name only, no separators)
      in `packages/eta-core/src/canonical-serialize.ts`
- [X] T011 Export `canonicalSerialize` (and money helpers) from
      `packages/eta-core/src/index.ts`; remove stub-only placeholder behavior
- [X] T012 **BLOCKING GATE — GOLDEN CANONICAL TESTS**: Implement
      `packages/eta-core/src/canonical-serialize.golden.spec.ts` that asserts
      `canonicalSerialize(input) === expected` **byte-exact** for every
      **locked** `*.canonical.txt` under
      `specs/005-document-building-serialization/golden-vectors/`
      (currently **gv-01**; auto-include newly promoted locked files). Normalize by
      stripping **at most one** trailing `\n` from expected and actual before
      `===`. For gv-01, load JSON with **number-literal preservation**. Suite MUST
      fail CI on any mismatch. **Do not assert `*.canonical.PENDING.txt`** until
      promoted. **No user-story tasks may start until this task passes.**
- [X] T013 **BLOCKING GATE — AGENT PARITY**: Implement .NET
      `CanonicalSerialize` mirroring the same algorithm and golden tests reading
      the **same** locked `*.canonical.txt` files (same trailing-`\n` normalization)
      in `apps/agent/` (e.g. `CanonicalSerialize.cs` +
      `CanonicalSerializeGoldenTests.cs`). **Must pass before user-story work.**
      No PKCS#11/signing. Skip PENDING.
- [X] T014 [P] Wire `pnpm --filter @einvoice/eta-core test` (and agent golden
      filter) into CI in `.github/workflows/ci.yml` so the blocking golden gate
      always runs on default CI
- [X] T015 [P] Unit tests for uppercasing / string-escape edge cases in
      `packages/eta-core/src/canonical-serialize.spec.ts` (alongside or
      separate from golden file)
- [X] T015a [P] **FR-029 / PENDING promote**: Keep skipped tests or checklist for
      gv-02..gv-08 `*.canonical.PENDING.txt`; after local EInvoicingSigner
      confirmation (runbook), rename to `*.canonical.txt` and ensure T012/T013
      pick them up — never self-generate from product serializer

**Checkpoint**: `canonicalSerialize` green on all **locked** golden files in
**eta-core and agent** (gv-01 minimum); money helpers green; Document schema
migrated with RLS. Promote PENDING vectors via runbook as confirmed. User
stories may begin after the locked gate is green.

---

## Phase 3: User Story 1 - Author document with taxes, discounts, totals (Priority: P1) 🎯 MVP

**Goal**: Invoice (primary) draft with server-authoritative line/document totals
as decimal strings; basic create/edit persistence

**Independent Test**: Create draft with multiple lines, discounts, taxes;
recomputed totals match worked examples as 2-dp strings; reopen draft intact;
client-supplied totals ignored

### Tests for User Story 1 (REQUIRED)

- [X] T016 [P] [US1] Unit tests for `calculateLine` /
      `calculateDocumentTotals` worked examples in
      `packages/eta-core/src/calculate-totals.spec.ts`
- [X] T017 [P] [US1] API tests for create/update draft + recompute (ignore client
      totals) in `apps/api/test/documents.draft.spec.ts`
- [X] T018 [P] [US1] Frontend smoke for documents form field labels in
      `apps/web/src/app/[locale]/(app)/documents/documents.smoke.test.tsx`

### Implementation for User Story 1

- [X] T019 [US1] Implement calculators in
      `packages/eta-core/src/calculate-totals.ts`
- [X] T020 [US1] Implement `buildInvoice` builder mapping draft DTO → ordered ETA
      payload in `packages/eta-core/src/builders/invoice.ts` (binding type/version
      supplied by caller from 004 catalog)
- [X] T021 [US1] Implement `DocumentsService` draft create/update/get/list with
      `withTenant`, recompute via eta-core, optimistic `version` in
      `apps/api/src/documents/documents.service.ts`
- [X] T022 [US1] Implement `DocumentsController` per
      `contracts/documents-api.yaml` (`GET/POST /documents`, `GET/PUT/DELETE
      /documents/{id}`) with `documents.view|manage` in
      `apps/api/src/documents/documents.controller.ts`
- [X] T023 [US1] Audit `documents.draft.create|update|delete` without secrets in
      `DocumentsService`
- [X] T024 [P] [US1] Web API client `apps/web/src/lib/api/documents.ts`
- [X] T025 [US1] Create/edit invoice form (lines, taxes, discounts, currency,
      branch) in `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx` (+ new
      route) using design system + next-intl
- [X] T026 [P] [US1] Documents list page in
      `apps/web/src/app/[locale]/(app)/documents/page.tsx` + nav link in app shell

**Checkpoint**: US1 DoD — draft invoice authoring + totals tests pass

---

## Phase 4: User Story 2 - Exact ETA canonical string (Priority: P1)

**Goal**: Product surfaces and CI keep canonical output locked; agent parity
already gated in Phase 2 — this story hardens edge coverage and preview wiring

**Independent Test**: Deliberate one-character algorithm break fails golden
suite; preview canonical matches `canonicalSerialize(etaPayload)`

### Tests for User Story 2 (REQUIRED)

- [X] T027 [P] [US2] Regression: intentional mutation test documenting that
      golden suite detects divergence (assert at least one locked gv fails if
      serialize reformats `0.00`→`0` or omits empty-array name token) in
      `packages/eta-core/src/canonical-serialize.golden.spec.ts` or sibling spec
- [X] T028 [P] [US2] API/contract test that preview `canonicalString` equals
      `canonicalSerialize(etaPayload)` in
      `apps/api/test/documents.preview.spec.ts`

### Implementation for User Story 2

- [X] T029 [US2] Implement preview endpoints
      `POST /documents/preview` and `POST /documents/{id}/preview` returning
      `etaPayload` + `canonicalString` + totals in
      `apps/api/src/documents/documents.controller.ts` /
      `documents.service.ts`
- [X] T030 [US2] Ensure builders never reorder properties; document order
      contract in `packages/eta-core/src/builders/` (Invoice path used by preview)
- [X] T031 [P] [US2] Confirm agent golden filter remains in CI; document run
      commands in `specs/005-document-building-serialization/quickstart.md`

**Checkpoint**: US2 DoD — preview + golden gate still blocking green

---

## Phase 5: User Story 3 - Local validation before submission (Priority: P1)

**Goal**: `LocalValidator` against 004 cached type-version; mark READY only when
clean; field-linked issues in UI

**Independent Test**: Missing required field / bad ref / arithmetic mismatch each
produce expected issue code+path; mark-ready refused until fixed

### Tests for User Story 3 (REQUIRED)

- [X] T032 [P] [US3] Unit tests for `LocalValidator` (required fields from fixture
      type-version schema; referential hooks; arithmetic) in
      `packages/eta-core/src/local-validator.spec.ts`
- [X] T033 [P] [US3] API tests validate + mark-ready success/failure in
      `apps/api/test/documents.validate.spec.ts`
- [X] T034 [P] [US3] Frontend smoke for validation message keys in
      `apps/web/src/app/[locale]/(app)/documents/documents-validation.smoke.test.tsx`

### Implementation for User Story 3

- [X] T035 [US3] Implement `LocalValidator` in
      `packages/eta-core/src/local-validator.ts` per `contracts/eta-core-api.md`
- [X] T036 [US3] Load 004 cached document type version metadata in
      `DocumentsService` and pass into validator (no hardcoded schema SoT)
- [X] T037 [US3] Implement `POST /documents/{id}/validate` and
      `POST /documents/{id}/mark-ready` in
      `apps/api/src/documents/documents.controller.ts`
- [X] T038 [US3] Audit validate / mark-ready outcomes (issue codes only) in
      `DocumentsService`
- [X] T039 [US3] Surface validation issues against form fields on
      `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx`

**Checkpoint**: US3 DoD — local validation + READY gate pass

---

## Phase 6: User Story 4 - Credit/debit notes & export variants (Priority: P2)

**Goal**: All six document kinds bind to catalog type/version; notes require
original-doc ref; export fields per version

**Independent Test**: Create one of each kind; notes fail validate without
reference; export requires extra fields from bound version

### Tests for User Story 4 (REQUIRED)

- [X] T040 [P] [US4] Unit tests for note/export builders + missing-reference
      validation in `packages/eta-core/src/builders/*.spec.ts` and/or
      `local-validator.spec.ts`
- [X] T041 [P] [US4] API tests for CREDIT_NOTE without reference → validate fail
      in `apps/api/test/documents.kinds.spec.ts`

### Implementation for User Story 4

- [X] T042 [P] [US4] Implement builders
      `credit-note.ts`, `debit-note.ts`, `export-invoice.ts`,
      `export-credit-note.ts`, `export-debit-note.ts` under
      `packages/eta-core/src/builders/`
- [X] T043 [US4] Wire kind→builder selection + catalog binding in
      `apps/api/src/documents/documents.service.ts`
- [X] T044 [US4] Extend documents form for kind selection, original-document
      reference, and export fields in
      `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx`

**Checkpoint**: US4 DoD — six kinds authorable + validated

---

## Phase 7: User Story 5 - Multi-currency & multi-branch (Priority: P2)

**Goal**: Branch issuer snapshot; FX from tenant rates; reject missing rate /
disabled currency / inactive branch

**Independent Test**: Same draft from two branches differs issuer snapshot; FX
document derives EGP amounts; missing rate fails validation with settings hint

### Tests for User Story 5 (REQUIRED)

- [X] T045 [P] [US5] API tests for FX resolution + missing rate + inactive branch
      in `apps/api/test/documents.fx-branch.spec.ts`
- [X] T046 [P] [US5] Calculator/builder unit coverage for foreign currency line
      unitValue fields in `packages/eta-core/src/calculate-totals.spec.ts`

### Implementation for User Story 5

- [X] T047 [US5] Resolve exchange rate from 003 `ExchangeRate` by issue date;
      populate issuer snapshot from branch in `DocumentsService`
- [X] T048 [US5] Validation messages for missing FX / disabled currency / inactive
      branch (bilingual keys) via `LocalValidator` + API mapping
- [X] T049 [US5] Branch + currency selectors limited to active/enabled options on
      documents form page

**Checkpoint**: US5 DoD — multi-branch/currency paths covered

---

## Phase 8: User Story 6 - Live preview & draft management (Priority: P3)

**Goal**: Live JSON + canonical panels; draft list/delete polish; RBAC deny for
Viewer manage

**Independent Test**: Edit refreshes JSON + canonical; delete removes one draft;
Viewer cannot POST/PUT/DELETE

### Tests for User Story 6 (REQUIRED)

- [X] T050 [P] [US6] RBAC deny tests Viewer cannot manage documents in
      `apps/api/test/documents.rbac.spec.ts`
- [X] T051 [P] [US6] Tenant isolation tests in
      `apps/api/test/documents.isolation.spec.ts`
- [X] T052 [P] [US6] Frontend smoke for preview panel copy in
      `apps/web/src/app/[locale]/(app)/documents/documents-preview.smoke.test.tsx`

### Implementation for User Story 6

- [X] T053 [US6] Live **ETA JSON** + **canonical string** preview panels on
      edit page (debounce to preview API) in
      `apps/web/src/app/[locale]/(app)/documents/[id]/page.tsx`
- [X] T054 [US6] Draft list actions (open/delete) + empty states on
      `apps/web/src/app/[locale]/(app)/documents/page.tsx`
- [X] T055 [US6] Optimistic concurrency: stale `version` → 409 surfaced in UI

**Checkpoint**: US6 DoD — preview + draft UX + RBAC/isolation pass

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: DoD, quickstart, no scope creep

- [X] T056 [P] Run eta-core golden + money + calculator + validator suites:
      `pnpm --filter @einvoice/eta-core test -- --runInBand`
- [X] T057 [P] Run API documents suites:
      `pnpm --filter @einvoice/api test -- --testPathPattern=documents --runInBand`
- [X] T058 [P] Run agent golden filter:
      `dotnet test apps/agent/Einvoice.Agent.sln --filter CanonicalSerialize`
- [X] T059 [P] Run web documents smoke:
      `pnpm --filter @einvoice/web test -- --testPathPattern=documents --runInBand`
- [X] T060 Confirm no ETA submit/sign/receipt scope creep; DoD review vs
      `spec.md` Out of Scope + constitution gates
- [X] T061 [P] Align `specs/005-document-building-serialization/quickstart.md`
      commands with final task IDs / scripts

**Checkpoint**: Default CI green; golden gate remains mandatory

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup → Foundational** → **BLOCKS all stories**
- **Foundational golden gate (T012 + T013)** must be green before US1–US6
- **US1** (authoring/totals) MVP after Foundational
- **US2** (canonical preview hardening) after US1 payload exists (golden already
  gated)
- **US3** (validation) after US1 builders produce payloads
- **US4** (kinds) after US1 invoice path
- **US5** (FX/branch) after US1
- **US6** (preview UX polish) after US2 preview API
- **Polish** last

### User Story Dependencies

| Story | Depends on |
|-------|------------|
| US1 | Phase 2 complete (incl. golden gate) |
| US2 | Phase 2 golden gate + US1 draft/payload |
| US3 | US1 (+ 004 cache available) |
| US4 | US1 builders pattern; US3 validator hooks |
| US5 | US1 service |
| US6 | US2 preview endpoints |

### Recommended sequence

1. Setup T001–T005  
2. Foundational T006–T015 with **T012/T013 blocking gate**  
3. US1 T016–T026 (MVP)  
4. US2 T027–T031  
5. US3 T032–T039  
6. US4 T040–T044  
7. US5 T045–T049  
8. US6 T050–T055  
9. Polish T056–T061  

### Parallel opportunities

- T002–T005 after T001  
- T008–T009 with T006–T007  
- T012 and T013 after T010–T011 (both blocking; can run in parallel once serialize
  exists in both languages)  
- Within a story: `[P]` test tasks in parallel  

### MVP

Phase 1–2 (**including golden gate**) + **US1** draft invoice authoring unlocks
value; US2/US3 next for parity preview + validation.

---

## Parallel Example: Foundational golden gate

```bash
# After T010–T011 land in both runtimes:
Task: "T012 BLOCKING golden tests for locked *.canonical.txt in packages/eta-core/.../canonical-serialize.golden.spec.ts"
Task: "T013 BLOCKING agent CanonicalSerializeGoldenTests.cs against same locked vectors"
```

## Parallel Example: User Story 1

```bash
Task: "T016 calculate-totals.spec.ts"
Task: "T017 documents.draft.spec.ts"
Task: "T018 documents.smoke.test.tsx"
```

---

## Implementation Strategy

### MVP first

1. Complete Setup  
2. Complete Foundational — **stop if T012 or T013 fail**  
3. Complete US1 — demo draft invoice + totals  
4. Add US2 preview + US3 validation before notes/export  

### Blocking golden rule (non-negotiable)

| Gate | Path | Assertion | Blocks |
|------|------|-----------|--------|
| T012 | `packages/eta-core/.../canonical-serialize.golden.spec.ts` | `canonicalSerialize(input) === expected` for every **locked** `*.canonical.txt` (strip ≤1 trailing `\n`); fixtures under `golden-vectors/` | All user stories |
| T013 | `apps/agent/.../CanonicalSerializeGoldenTests` | Same locked fixtures + same newline rule | All user stories |
| T014 | `.github/workflows/ci.yml` | Golden suites always run on default CI | Merge gate |

- Never generate expected strings from the implementation under test  
- Never skip locked golden tests in default CI  
- gv-01 requires format-preserving JSON load  
- gv-02..gv-08 remain PENDING until EInvoicingSigner `CanonicalString.txt` confirms  
- Algorithm SoT: `packages/eta-core/docs/reference-algorithm.md`  

### Notes

- Money = decimal strings; no IEEE floats on ETA payload  
- Empty array = emit name once (reference SerializeToken)  
- Strings = `JsonConvert.ToString` escaping (not raw); null = name only  
- Validation SoT = 004 cached type-version  
- No document submission or CAdES signing in this feature  
- Client totals are never trusted  
