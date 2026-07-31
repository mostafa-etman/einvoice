# Research: Bulk Import / Export

**Feature**: `009-bulk-import-export` | **Date**: 2026-07-31

Resolves Technical Context unknowns and encodes the user plan: papaparse/xlsx
streaming import, valid-rows-only, ETA package request → Get Package Requests →
zip to MinIO, local exporters, Import Wizard + Export Center, test strategy.

---

## R1 — Import parse stack (CSV + XLSX streaming)

**Decision**:
- **CSV**: `papaparse` in Node with **stream / step** mode over the uploaded
  file stream (or temp file stream). Emit rows incrementally into validation.
- **XLSX**: `xlsx` (SheetJS) for template generation and import parse. For large
  files, use row-oriented read (`sheet_to_json` with range windows / workbook
  stream hooks where available) so validation progresses without holding the
  full cell matrix in app memory longer than necessary. Reject `.xls`.
- Parsing runs **on the API worker** after upload to MinIO (or local temp), never
  trusting client-side-only validation as authoritative.

**Rationale**: Matches clarified formats (CSV + XLSX) and streaming requirement
(SC-005a / FR-002a); user plan explicitly names papaparse/xlsx.

**Alternatives considered**: ExcelJS-only (excellent streaming writer/reader but
diverges from requested deps); browser-only parse (fails tenant audit + large
file limits; security weaker).

---

## R2 — Row validation & “bad rows don’t block”

**Decision**: Two-phase job after mapping is confirmed:
1. **Validate** all rows → persist `ImportRowResult` per row + aggregate counts;
   write **error report** artifact (CSV/XLSX) for invalid rows.
2. **Run** creates documents **only** for `VALID` rows. Presence of invalid rows
   never fails the run if ≥1 valid row exists. File-level errors
   (unsupported type, corrupt file, missing required mapping, over
   `IMPORT_MAX_BYTES` / `IMPORT_MAX_ROWS`) fail the job before create.

Validation reuses the same field/business rules as interactive document create
(required issuer/receiver/lines/taxes/codes as enforced by documents service).

**Rationale**: Spec clarification 2026-07-31 + FR-005.

**Alternatives considered**: All-or-nothing commit (rejected by clarification);
client-only validation (not auditable).

---

## R3 — Map → documents → sign + submit

**Decision**:
- Map each valid row → document create DTO → call existing documents create /
  build path (same as UI) so lifecycle starts `DRAFT`/`READY` consistently.
- Store `importJobId` (and row number) on document metadata or join table for
  lineage (FR-021).
- Wizard flag `signAndSubmit`:
  - `false` → stop after create (**Create only**).
  - `true` → enqueue existing **`sign`** jobs per document (007 bridge); after
    agent signs, existing pipeline auto-enqueues **`submit`** (FR-040 behavior).
- Do **not** invent a parallel submit path or mutate signed payloads.

**Rationale**: Spec FR-006/FR-007; constitution IV; user plan “enqueue sign+submit
in batches”.

**Alternatives considered**: Synchronous sign in API (impossible for token);
direct submit without agent (unsigned — illegal).

---

## R4 — Error report artifact

**Decision**: After validation (and after run), store a downloadable **CSV**
error report under MinIO
`tenants/{tenantId}/artifacts/imports/{importJobId}/error-report.csv`
(columns: rowNumber, businessKey?, field, code, message). Optional XLSX mirror
if cheap; CSV is required MVP. UI shows counts + download link.

**Rationale**: FR-004; easy to reopen in spreadsheet tools.

**Alternatives considered**: JSON-only report (worse for accountants); inline
DB-only without file (FR requires downloadable report).

---

## R5 — ETA document package flow

**Decision** (paths relative to `ETA_API_BASE_URL`):

| Step | ETA API | Usage |
|------|---------|--------|
| Request | `POST /api/v1.0/documentpackages/requests` | Create package request; store returned package/request id |
| Track | `GET /api/v1.0/documentpackages/requests` | **Canonical status** until ready (`status` complete) or error/deleted |
| Download | `GET /api/v1.0/documentpackages/{rid}` | Zip body on 200; 204 = not ready yet |

- BullMQ **`package-poll`** job polls Get Package Requests (and may probe Get
  Document Package) with env backoff until complete/error/stall.
- Package-ready webhook (007) **accelerates** a poll check only; never sole
  status source (FR-013).
- On ready: stream/store zip to MinIO
  `tenants/{tenantId}/artifacts/packages/{etaPackageRequestId}.zip`.

**Rationale**: Spec clarification + official ETA docs; user plan.

**Alternatives considered**: Webhook-only (fails when ETA cannot callback);
Get Document Package spin without Get Package Requests (weaker list/status UX).

---

## R6 — Local exporters

**Decision**: `ExportJob` with `formats: ('CSV'|'XLSX'|'PDF'|'JSON')[]` and
filter snapshot (date range, type, status, branch). Worker loads permitted
documents and writes artifacts:

| Format | Approach |
|--------|----------|
| CSV | Streaming write of flat summary (+ optional lines sheet strategy: one CSV summary MVP) |
| XLSX | `xlsx` workbook write (summary sheet; lines sheet if needed) |
| JSON | Array of document snapshots (builder/ETA payload summary — never secrets) |
| PDF | Prefer cached authority printout when present; else product PDF representation; multi-doc → **zip of PDFs** (consistent, labeled) |

Artifacts under `tenants/{tenantId}/artifacts/exports/{exportJobId}/...` with
retention `EXPORT_ARTIFACT_TTL_DAYS` (env).

**Rationale**: FR-010/FR-022; zip-of-PDFs avoids fragile mega-PDF.

**Alternatives considered**: Single concatenated PDF only (harder, poorer UX on
partial failures).

---

## R7 — Queues

**Decision**: Extend `queue-names.ts`:

| Queue | Purpose |
|-------|---------|
| `import` | Validate + create (+ enqueue sign when requested) |
| `export` | Local multi-format generation |
| `package-poll` | Get Package Requests loop → Get Document Package → MinIO |
| `sign` / `submit` / `poll` | Existing — reused, not forked |

All jobs carry `tenantId` and re-assert RLS.

**Rationale**: Isolation of backoff/rate limits; clear retries.

**Alternatives considered**: One `bulk` queue (mixed SLAs); inline HTTP for
large imports (timeouts).

---

## R8 — Permissions

**Decision**: MVP reuse `documents.view` / `documents.manage` (same as 007):

| Permission | Capabilities |
|------------|----------------|
| `documents.view` | List import/export/package jobs; download artifacts & error reports |
| `documents.manage` | Upload, validate, run import; create local export; request ETA package |

**Rationale**: Fastest least-privilege alignment with existing roles; FR-016
allows distinct codes later (`imports.manage` / `exports.manage`) without
blocking DoD.

**Alternatives considered**: New permission codes now (extra seed/migration
noise for same role matrix).

---

## R9 — Web UX shape

**Decision**:
- **Import Wizard** steps: Upload → Column mapping → Validation report → Run
  (Create only | Create, sign & submit) → progress/history.
- **Export Center**: Create local export; Request ETA package; track/download
  jobs; history with expiry messaging.
- Routes: `/[locale]/imports`, `/[locale]/exports` (+ job detail).
- All copy via next-intl `imports.*` / `exports.*` (ar/en + RTL).

**Rationale**: Spec user stories; matches product nav patterns.

---

## R10 — Test strategy (acceptance)

**Decision**:
1. **Unit**: parser fixtures (CSV + XLSX); mapping; validation classifier;
   “N invalid + M valid → M creates”.
2. **Integration (API)**: upload fixture with **dozens of rows including bad
   rows** → run import → assert only valid document ids; error report lists bad
   rows; with `signAndSubmit` mocked/enqueued, assert sign jobs only for valid.
3. **Sandbox gated** (`ETA_SANDBOX_INTEGRATION=1`): Request Document Package →
   poll Get Package Requests → Get Document Package → object exists in MinIO.
4. **Contract**: JWT + tenant header; Viewer cannot run import; cross-tenant
   artifact 404.
5. **Web smoke**: wizard step labels present in en/ar.

**Rationale**: User plan + SC-002/SC-005/SC-007.

---

## R11 — Limits & retention

**Decision**: Env (optional per-tenant override later):

| Variable | Suggested default |
|----------|-------------------|
| `IMPORT_MAX_BYTES` | 25MB |
| `IMPORT_MAX_ROWS` | 5000 |
| `EXPORT_ARTIFACT_TTL_DAYS` | 14 |
| `PACKAGE_POLL_INITIAL_MS` | 5000 |
| `PACKAGE_POLL_MAX_MS` | 120000 |
| `PACKAGE_STALL_HOURS` | 24 |

**Rationale**: Spec FR-014/FR-019; mirrors submission poll style.

---

## R12 — Agent scope

**Decision**: **No desktop agent code changes** for this feature. Import with
sign & submit enqueues existing sign queue; user must have paired agent online
(edge case already in spec).

**Rationale**: Constitution VIII + 007 sign bridge already exists.
