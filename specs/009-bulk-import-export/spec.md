# Feature Specification: Bulk Import / Export

**Feature Branch**: `009-bulk-import-export`

**Created**: 2026-07-31

**Status**: Clarified

**Input**: User description: "Feature: Bulk import/export.
- Import: CSV/Excel templates → parse → validate row-by-row → build documents → sign → submit as batches. Provide a downloadable template and a per-row error report.
- Export: request/download document packages from ETA (Request/Get Document Package) and local export (CSV/Excel/PDF/JSON).
Frontend: Import Wizard (upload, column mapping, validation report), Export Center."

## Clarifications

### Session 2026-07-31

- Q: Which import file formats are supported, and how are large files parsed? → A: **CSV + XLSX only**, with **streaming parse** for large files so rows are read incrementally (validation/progress does not require loading the entire file into memory at once). Legacy `.xls` is out of scope.
- Q: Do invalid rows block importing valid ones? → A: **No.** Bad rows are **reported** in the per-row error report and **do not block** creation of valid rows. File-level failures (unreadable file, missing required mapping, over size/row limits) still block the job.
- Q: How are ETA export packages tracked until downloadable? → A: After Request Document Package, status is tracked via **Get Package Requests** until the package is **ready** (then Get Document Package / download). Package-ready notifications may accelerate a check but **Get Package Requests** is the canonical status path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download a template and import documents via wizard (Priority: P1)

An accountant needs to create many issued invoices (or other supported issued
document types) from a spreadsheet. They download the organization’s official
**CSV or XLSX** template, fill rows, and open the **Import Wizard**. They upload
the file (parsed with streaming for large files), confirm or adjust column
mapping, run validation, review a per-row error report, and—for rows that
pass—confirm creation even when other rows failed. Optionally in the same
wizard they choose to continue through signing and submission in batches (with
explicit consent), reusing the existing signing-agent and submission pipeline.

**Why this priority**: This is the core value of the feature—high-volume document
intake without manual one-by-one entry—and unblocks the bulk filing path deferred
from the submission pipeline.

**Independent Test**: Download the invoice template, upload a small valid file
plus one intentionally invalid row, complete mapping and validation, confirm the
error report names the bad row, import only valid rows into draft/ready documents,
and (with agent available) optionally continue to sign and submit those documents
as a batch.

**Acceptance Scenarios**:

1. **Given** an authorized user opens Import, **When** they choose a supported
   document type and download the **CSV or XLSX** template, **Then** they receive a
   file whose headers and sample guidance match that type’s required and optional
   fields.
2. **Given** a filled CSV or XLSX template file, **When** the user uploads it in the Import
   Wizard, **Then** the system parses the file (streaming for large files) and proposes a column mapping
   (auto-matched where headers match the template; editable where they do not).
3. **Given** mapping is confirmed, **When** the user runs validation, **Then**
   every data row is validated independently and the wizard shows counts of
   valid vs invalid rows plus a downloadable/viewable **per-row error report**
   (row number, field, message); invalid rows never prevent proceeding with valid ones.
4. **Given** some rows are valid and some invalid, **When** the user confirms
   import, **Then** only valid rows become documents for the
   organization; invalid rows are reported and not created; the presence of bad
   rows does **not** block valid rows; the job summary and error report
   remain available.
5. **Given** valid rows were imported and the user chose “Create only”, **When**
   the job finishes, **Then** documents exist in the normal document lifecycle
   (draft/ready as appropriate) without automatic submission.
6. **Given** valid rows were imported and the user explicitly chose “Create,
   sign & submit”, **When** the job proceeds, **Then** documents are built,
   queued for signing via the desktop agent path, and submitted in batches
   through the existing submission pipeline; progress and failures are visible
   per document and in the import job summary.
7. **Given** an import job runs, **When** an auditor reviews the audit log,
   **Then** they see actor, organization, file identity/summary, action
   (validate / import / sign-submit), outcome counts, and timestamp (no secrets).

---

### User Story 2 - Fix mapping and re-validate before committing (Priority: P1)

The user’s export from another system uses different column names. In the wizard
they map columns to the expected fields, re-run validation, and only commit when
they understand remaining errors.

**Why this priority**: Real-world files rarely match the template exactly;
without mapping, import adoption fails.

**Independent Test**: Upload a CSV with renamed headers, map each required
column correctly, validate successfully, then remapping a required column away
and confirm validation fails with a clear message.

**Acceptance Scenarios**:

1. **Given** an uploaded file whose headers do not all match the template,
   **When** the user opens the mapping step, **Then** they can assign each
   source column to a target field (or leave optional fields unmapped) and see
   which required fields are still unmapped.
2. **Given** required fields are unmapped or mapped to empty columns, **When**
   validation runs, **Then** the wizard blocks proceed-to-import and explains
   what is missing.
3. **Given** the user changes mapping after a validation run, **When** they
   validate again, **Then** the previous error report is replaced by a fresh
   report for the new mapping.

---

### User Story 3 - Local export of documents (CSV / XLSX / PDF / JSON) (Priority: P1)

Finance needs a local package of issued (and optionally filtered) documents for
accounting systems, archives, or sharing. From the **Export Center** they choose
filters (date range, type, status, branch), choose format(s)—CSV, XLSX, PDF,
and/or JSON—and download when ready.

**Why this priority**: Day-to-day operational need independent of authority
package APIs; delivers immediate value even if ETA package retrieval is slow or
unavailable.

**Independent Test**: Select a known set of documents, request CSV and JSON
exports, download both when complete, and confirm contents match the filter
(document identities and key fields present; no other tenant’s data).

**Acceptance Scenarios**:

1. **Given** an authorized user opens the Export Center, **When** they set
   filters and request a **local** export in one or more of CSV, XLSX, PDF,
   JSON, **Then** the system creates an export job scoped to their organization
   and shows job status (queued, running, ready, failed).
2. **Given** an export job is ready, **When** the user downloads it, **Then**
   they receive files in the requested formats containing only documents that
   matched the filters.
3. **Given** PDF is requested for multiple documents, **When** the export
   completes, **Then** the user receives either a multi-document PDF package or
   a zip of per-document PDFs (product chooses one consistent approach) with a
   clear inventory of what was included and what could not be rendered.
4. **Given** export fails (empty filter result, generation error), **When** the
   user views the job, **Then** they see a clear reason and can retry or adjust
   filters without leaving the Export Center.

---

### User Story 4 - Request and download ETA document packages (Priority: P2)

Compliance needs the official authority **document package** for one or more
already-filed documents. From the Export Center (or from a document context that
deep-links into it) they **request** a package from ETA; the product tracks the
request via **Get Package Requests** until status is ready, then downloads the
package. A package-ready notification may trigger an earlier status check but
does not replace Get Package Requests as the source of truth.

**Why this priority**: Required for official packages but depends on authority
async behavior; secondary to local export for daily ops.

**Independent Test**: For a sandbox document that supports package retrieval,
request a package, observe statuses driven by Get Package Requests until ready,
download the package, and confirm it is stored against the organization and
linked to the request.

**Acceptance Scenarios**:

1. **Given** one or more documents with authority identities that allow package
   requests, **When** an authorized user requests an ETA document package,
   **Then** the system calls the authority’s Request Document Package capability,
   records a package request job, and shows status (requested, pending, ready,
   failed).
2. **Given** a pending package request, **When** the system polls **Get Package
   Requests** and the authority reports ready, **Then** the system retrieves the
   package (Get Document Package), the user can download it from the Export
   Center, and the retrieval is audited.
3. **Given** request, Get Package Requests, or get-package fails, **When** the
   user views the job, **Then** they see an actionable error (without secrets)
   and may retry when eligible.
4. **Given** a package-ready notification arrives for this organization,
   **When** it matches a pending request, **Then** the system immediately
   re-checks status via **Get Package Requests** (and proceeds to download when
   ready) without requiring the user to re-submit the request.

---

### User Story 5 - Monitor import and export job history (Priority: P2)

A power user returns later to see past imports and exports: what file was used,
how many rows succeeded or failed, download prior error reports, and re-download
completed export artifacts while they remain available.

**Why this priority**: Essential for ops and support, but usable after core
wizard and export flows exist.

**Independent Test**: Complete one import and one local export; reopen Import /
Export history; re-download the import error report and the export artifact.

**Acceptance Scenarios**:

1. **Given** prior import jobs exist for the organization, **When** the user
   opens import history, **Then** they see date, actor, document type, counts,
   status, and links to error report when applicable.
2. **Given** prior export / package jobs exist, **When** the user opens Export
   Center history, **Then** they see job type (local vs ETA package), filters
   summary, status, and download when still available.
3. **Given** an export artifact has expired or been purged per retention rules,
   **When** the user tries to download, **Then** they are told it is no longer
   available and may re-run the export.

---

### User Story 6 - Branch and permission-aware bulk operations (Priority: P3)

Multi-branch organizations restrict who can import into which branch and who can
export which documents. Imports assign a branch when provided in the file or
chosen in the wizard; exports respect the user’s branch visibility.

**Why this priority**: Important for larger tenants; single-branch orgs can use
defaults.

**Independent Test**: As a branch-limited user, import with a branch column and
confirm documents land on the allowed branch; attempt export outside visibility
and confirm those documents are excluded or denied per permission rules.

**Acceptance Scenarios**:

1. **Given** the user selects or maps a branch on import, **When** documents are
   created, **Then** each document is associated with that branch (or per-row
   branch when the template includes it).
2. **Given** a user lacks import or export permission, **When** they open the
   wizard or Export Center actions, **Then** those actions are unavailable or
   refused with a clear message.
3. **Given** branch-scoped visibility rules, **When** a user exports, **Then**
   only documents they are allowed to see are included.

---

### Edge Cases

- Empty file or file with headers only: validation fails with a clear “no data
  rows” message; nothing is imported.
- File exceeds configured max size or max row count: upload/validation is
  rejected before processing with the limit explained.
- Duplicate internal IDs within the same file or conflicting with existing
  unfiled documents: affected rows fail validation with a duplicate message;
  other valid rows may still import.
- Mixed document types in one file: rejected unless the chosen template/type
  matches; one import job is one document type.
- Encoding / delimiter issues (CSV) or corrupt XLSX: parser failures surface as
  file-level errors with guidance to use the official CSV/XLSX template.
- Legacy `.xls` upload: rejected as unsupported format with guidance to use
  CSV or XLSX.
- Large CSV/XLSX files within configured limits: streaming parse continues
  row-by-row; the user sees progress and partial validation results without the
  job failing solely due to file size (unless max size/row limits are exceeded).
- Import with “sign & submit” while no paired signing agent is online: documents
  are created and left pending signature; the job summary shows signing blocked
  with guidance to start the agent—not a silent success.
- Partial batch submission failures after import: per-document outcomes follow
  the submission pipeline; the import job links to those documents’ statuses.
- Local export with zero matches: job completes as failed/empty with explanation;
  no empty misleading “success” file pretending data exists (or an explicitly
  labeled empty result—product MUST be consistent and clear).
- ETA package requested for a document lacking required authority identity:
  request is refused locally with explanation before calling the authority.
- Concurrent imports by two users: both may run; each job is isolated; no
  cross-tenant leakage; duplicate business keys still fail validation per rules.
- Tenant A must never see Tenant B’s import files, error reports, export
  artifacts, or ETA packages.
- Authority rate limits or downtime during package request/get: job retries with
  backoff where appropriate and surfaces a stalled/failed state after configured
  limits.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide downloadable **CSV and XLSX** templates per
  supported **issued** document type (at minimum the types already creatable in
  the product’s document builder for the organization), including required/
  optional field guidance. Legacy `.xls` templates are out of scope.
- **FR-002**: System MUST provide an **Import Wizard** that supports: file
  upload (**CSV and XLSX only**), **column mapping**, row-by-row **validation**, a
  **validation/error report**, and confirmation to create documents from valid
  rows.
- **FR-002a**: System MUST **stream-parse** CSV and XLSX imports for large files
  so rows are read incrementally; validation and progress MUST NOT require
  loading the entire file into memory at once.
- **FR-003**: System MUST validate each data row independently against the same
  business rules used for interactive document creation (required fields, codes,
  totals consistency rules exposed by the product, receiver/issuer constraints
  as applicable) and MUST record field-level errors with row identity.
- **FR-004**: Users MUST be able to download or view a **per-row error report**
  for a validation or import job (row number, identifier if present, field,
  message).
- **FR-005**: System MUST import **valid rows** even when other rows fail; bad
  rows MUST be **reported** and MUST **not** block valid rows. The system MUST
  NOT create documents for invalid rows. Only **file-level** failures (unreadable
  file, unsupported format, incomplete required mapping, over size/row limits)
  MAY block the entire job.
- **FR-006**: On import confirm, system MUST **build** documents using the
  existing document-building rules (canonical fields, line items, taxes) so
  imported documents are equivalent in structure to UI-created ones.
- **FR-007**: Import Wizard MUST offer an explicit post-create choice:
  **Create only** versus **Create, sign & submit**. Sign & submit MUST require
  affirmative user consent in the wizard and MUST reuse the existing desktop
  signing path and submission batch pipeline (including batching, duplicate-safe
  filing, and status updates). Unattended scheduled/cron import-from-watched-folder is
  **out of scope** for this release; bulk filing is initiated by the user’s
  import job confirmation.
- **FR-008**: System MUST persist **import jobs** (tenant-scoped) with status,
  counts (total/valid/invalid/created/sign-pending/submitted/failed), actor,
  source file metadata (name, size, checksum), document type, and timestamps.
- **FR-009**: System MUST provide an **Export Center** for requesting and
  tracking exports.
- **FR-010**: Export Center MUST support **local export** of filtered documents
  to **CSV**, **XLSX**, **PDF**, and **JSON** (user may select one or more
  formats per job).
- **FR-011**: Local export MUST honor filters at least for: date range, document
  type, status, and branch (when branches exist), and MUST include only
  documents the user is permitted to access.
- **FR-012**: System MUST support **Request Document Package**, status tracking
  via **Get Package Requests** until ready/failed, and **Get Document Package**
  download for eligible filed documents.
- **FR-013**: Pending ETA package jobs MUST be tracked by polling **Get Package
  Requests** until ready (or failed/stalled per configured limits). A verified
  **package-ready** notification MAY trigger an immediate Get Package Requests
  check for a matching pending request, but MUST NOT be the sole status mechanism.
- **FR-014**: System MUST retain export and package artifacts for a configured
  retention period and MUST allow re-download until expiry; after expiry users
  MUST be told to re-run the job.
- **FR-015**: All import validations/commits, export requests/downloads, and ETA
  package request/get/download actions MUST be **auditable** (actor, tenant,
  action, outcome, timestamp; no secrets or raw credential material).
- **FR-016**: Access MUST be permission-gated (import vs export vs package
  retrieve as distinct capabilities where least privilege requires); users
  without permission MUST NOT upload, commit, or download others’ bulk
  artifacts.
- **FR-017**: Import files, job records, error reports, export artifacts, and
  ETA packages MUST be **tenant-isolated**; background workers MUST run in a
  single-tenant context per job.
- **FR-018**: Import and Export UIs MUST be available in **Arabic and English**
  with correct RTL for Arabic, using the existing design system and responsive
  layouts.
- **FR-019**: System MUST enforce configurable **max upload size** and **max
  rows per import** (environment defaults with optional organization override);
  limits MUST be visible to the user when exceeded.
- **FR-020**: One import job MUST target a **single document type**; mixing
  types in one file is not supported.
- **FR-021**: Imported documents MUST participate in the normal document
  lifecycle and appear in existing document lists/detail views with a clear
  link back to the originating import job when created via import.
- **FR-022**: Local PDF export MUST use available printouts (authority PDF when
  already stored/retrievable, or the product’s standard document PDF
  representation when authority PDF is not applicable); failures per document
  MUST be listed in the job inventory without failing unrelated documents
  unnecessarily.
- **FR-023**: Out of scope for this release: ERP/API push connectors, email
  inbox import, watched-folder/cron file pickup, editing documents inside the
  error report spreadsheet as a round-trip “fix and re-upload only failed
  rows” automation beyond downloading the error report and a standard template
  for manual correction, and purchase/received-document bulk import (Purchases
  remains the inbound path).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios are testable; import
  commit, sign-submit handoff, local export, and ETA package request/get/
  download produce audit events with actor, tenant, outcome.
- **CC-002 Security**: Uploaded files and artifacts are stored with tenant
  isolation and access control; ETA credentials remain server-side encrypted
  and never appear in wizard UI, exports, or logs; TLS for authority calls;
  downloads require authZ.
- **CC-003 Tenant Isolation**: Import jobs, rows, exports, and packages are
  tenant-scoped; RLS (or equivalent) on tenant tables; object storage keys/
  prefixes tenant-scoped; workers set tenant context per job.
- **CC-004 ETA Serialization**: Documents built from import MUST use the same
  canonical serialization and signing path as UI-created documents; no alternate
  “bulk-only” serializer. Sign & submit reuses agent/backend parity vectors
  already required by prior features—no fork of serialization for bulk.
- **CC-005 Runtime ETA Config**: Package request/get endpoints and related URLs
  MUST come from runtime/environment ETA configuration; no hardcoded production
  or sandbox URLs for live calls.
- **CC-006 Sandbox-First**: Non-production package and submission traffic from
  bulk flows targets sandbox/preprod by default; production is separately
  provisioned.
- **CC-007 UX/i18n**: Import Wizard and Export Center ship ar/en via next-intl,
  RTL for Arabic, responsive layout, shared design system.
- **CC-008 Full-Stack Phase**: Backend import/export/package APIs and jobs plus
  Frontend Import Wizard and Export Center ship together with automated tests;
  signing path uses the existing desktop agent (no agent rewrite required unless
  a bulk-specific gap is discovered—and then it ships in the same phase).

### Key Entities *(include if feature involves data)*

- **Import Job**: Tenant-scoped bulk import run; actor; source file metadata;
  document type; mapping snapshot; status; counts; optional “sign & submit”
  flag; timestamps; link to created documents.
- **Import Row Result**: Per-row outcome for a job (row number, external/business
  key if provided, valid/invalid, error list, created document id when
  successful).
- **Column Mapping**: Snapshot of source-column → target-field assignments used
  for a validation/import attempt.
- **Export Job**: Tenant-scoped local export request; filters snapshot; requested
  formats; status; artifact location(s); actor; expiry; timestamps.
- **ETA Package Request**: Tenant-scoped authority package request; related
  document identities; authority request references; status from **Get Package
  Requests** (requested/pending/ready/failed); artifact location; optional
  notification correlation that accelerates the next Get Package Requests check;
  actor; timestamps.
- **Document** (existing): Created/updated by import; filter target for export;
  identity source for ETA package; retains lifecycle and submission linkage.
- **Branch** (existing): Optional assignment on import and filter on export.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authorized user can download a template, upload a 50-row valid
  file, complete mapping and validation, and create documents in **under 5
  minutes** of active wizard time (excluding signing-agent wait and authority
  processing).
- **SC-002**: For a file with mixed valid/invalid rows, **100%** of invalid rows
  appear in the error report with row number and at least one actionable
  message, **0** invalid rows become documents, and **100%** of valid rows are
  eligible to import without being blocked by the bad rows.
- **SC-003**: After “Create, sign & submit” on a small valid batch (≤20 docs)
  with an online signing agent and sandbox credentials, documents reach the
  submission pipeline and show non-draft terminal or in-progress authority-facing
  statuses consistent with the submission feature within the same operational
  expectations as manual submit (user can track progress without leaving product
  context).
- **SC-004**: Users can request a local CSV or XLSX export of up to **500**
  matching documents and receive a downloadable artifact within **3 minutes**
  under normal conditions (excluding extreme PDF-heavy jobs).
- **SC-005**: Users can complete an ETA package path—Request Document Package →
  track via **Get Package Requests** until ready → download—for an eligible
  sandbox document without support intervention when the authority responds
  successfully.
- **SC-005a**: A large import file (at least **2,000** data rows, within
  configured limits) of CSV or XLSX completes validation without requiring the
  entire file to be held in memory at once (streaming parse), and surfaces
  progress or completion to the user.
- **SC-006**: In usability checks, **90%** of first-time importers successfully
  complete a Create-only import of the official template without assistance when
  given a correctly filled sample file.
- **SC-007**: Cross-tenant checks show **zero** leakage of import files, error
  reports, export artifacts, or packages between organizations.
- **SC-008**: Arabic and English users can complete the Import Wizard and a
  local export with correct RTL/LTR layout and no untranslated critical wizard
  steps.

## Assumptions

- Supported import document types are the **issued** types already creatable in
  the product (invoice, credit note, debit note, and export variants if already
  supported by document building)—not received/purchase documents.
- Column mapping is **per job** (optionally remembered as a convenience later);
  a saved “mapping profile library” is nice-to-have and not required for MVP if
  auto-match + manual map suffices.
- “Create, sign & submit” is the fulfillment of the bulk submission path deferred
  from the submission pipeline; it is **user-initiated via the wizard**, not a
  watched-folder or cron pickup in this release.
- Import and local spreadsheet export formats are **CSV and XLSX** only (not
  legacy `.xls`).
- Per-row error report format is CSV or XLSX download plus on-screen summary;
  round-trip “upload only failed rows” automation is out of scope beyond manual
  correction.
- Local PDF export may zip multiple PDFs when multi-doc single-file PDF is
  impractical; the Export Center labels the package clearly.
- ETA package lifecycle follows Request Document Package → **Get Package
  Requests** (canonical status until ready) → Get Document Package / download.
  Package-ready notifications are optional accelerators only.
- Max rows / file size defaults are set at environment level (suggested starting
  point: on the order of thousands of rows and tens of MB) and can be tuned
  without a spec change.
- Existing auth, tenant context, document builder, signing agent pairing, and
  submission pipeline are dependencies and are reused rather than reimplemented.
- Export Center is the home for both local exports and ETA packages; document
  detail may deep-link into a pre-filled package request for convenience.
