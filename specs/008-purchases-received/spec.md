# Feature Specification: Purchases (Received Documents) & Purchase Returns

**Feature Branch**: `008-purchases-received`

**Created**: 2026-07-31

**Status**: Clarified

**Input**: User description: "Feature: Purchases (received invoices) and purchase returns (received credit notes).
- Backend jobs (scheduled + on-demand) to pull RECEIVED documents via Search Documents / Get Recent Documents (direction = received). Classify: received Invoices = purchase invoices; received Credit Notes = purchase returns. Store with details; support accept/reject and reconciliation.
Frontend: Purchases module with filters (date/branch/type/status), detail view, PDF download, accept/reject."

## Clarifications

### Session 2026-07-31

- Q: How is received-document sync triggered? → A: **Scheduled (cron) + manual
  "Sync now".** Both paths run the same pull/upsert pipeline. Schedule
  enablement and interval are environment configuration; "Sync now" is always
  available to authorized users from the Purchases UI when credentials allow.
- Q: What is the dedupe / upsert key for received documents? → A: **Authority
  document uuid.** Tenant-scoped uniqueness is `(tenant, documentUuid)`. Sync
  MUST upsert on that key so search + recent pulls never create duplicates.
  Rows without a uuid are not stored as purchases; they count as sync failures
  until a uuid is available.
- Q: What does reconciliation include in this release? → A: **Local review
  statuses only; purchase-order matching is out of scope now, but hooks are
  kept.** Users set pending review / reconciled / disputed (+ optional note).
  The data model MUST reserve a stable extension point (nullable PO / match
  linkage and room for a future matcher) so a later feature can match against
  local POs without a breaking redesign. No PO list, auto-match, or match UI
  in this release.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync and browse received purchases (Priority: P1)

An accountant opens the Purchases module and sees invoices that suppliers filed to
their organization at the tax authority. They can refresh on demand or rely on a
scheduled sync. Each received invoice appears as a **purchase invoice**; each
received credit note appears as a **purchase return**. They filter by date range,
branch, document type (purchase vs purchase return), and status, then open a
detail view with full document content (issuer, lines, taxes, totals, authority
identifiers).

**Why this priority**: Without a reliable sync and browse path, every other
purchase capability is unusable. This is the MVP that makes inbound documents
visible.

**Independent Test**: With sandbox credentials configured, trigger an on-demand
sync for a tenant that has at least one received invoice and one received credit
note at the authority; confirm both appear in Purchases with the correct
classification and can be opened in detail.

**Acceptance Scenarios**:

1. **Given** the organization has configured ETA credentials for the active
   environment, **When** a user with purchase view permission triggers "Sync
   now", **Then** the system pulls received documents from the authority,
   stores or updates them for that organization only, and shows a completion
   summary (fetched, new, updated, failed).
2. **Given** received documents exist for the organization, **When** the user
   opens Purchases with filters (date range, branch, type, status), **Then**
   only matching documents are listed and the list updates when filters change.
3. **Given** a received invoice and a received credit note were synced,
   **When** the user views the list, **Then** the invoice is labeled as a
   purchase invoice and the credit note as a purchase return.
4. **Given** a synced received document, **When** the user opens its detail
   page, **Then** they see issuer identity, document identifiers (internal id,
   authority uuid / long id when present), issue date, lines, taxes, totals,
   current local status, and authority status snapshot.
5. **Given** the scheduled **cron** sync is enabled for the environment,
   **When** the schedule fires, **Then** received documents are pulled without
   user action and newly arrived documents appear in Purchases on the next page
   load or refresh.

---

### User Story 2 - Accept or reject a received document (Priority: P1)

A reviewer examines a purchase invoice and either **accepts** it (acknowledges
receipt for the buyer side) or **rejects** it with a reason when it should not
be accepted. The action is sent to the tax authority where required, recorded
locally with an audit trail, and the document’s status updates in the Purchases
list and detail view.

**Why this priority**: Submission-pipeline work explicitly deferred
receiver-side accept/reject of inbound documents to Purchases; this is a
regulated buyer obligation and a core product gap.

**Independent Test**: On a synced received document in a state that allows
buyer action, perform accept and (on another document) reject with a reason;
confirm local status, audit entry, and authority-facing outcome are consistent
with the chosen action.

**Acceptance Scenarios**:

1. **Given** a received document is eligible for buyer accept/reject,
   **When** an authorized user accepts it, **Then** the system records the
   acceptance, updates local status, attempts the authority-side accept action
   when applicable, and shows success or a clear failure message without losing
   the user’s intent record if the authority call fails after a local attempt
   (retryable / needs attention).
2. **Given** a received document is eligible for buyer reject,
   **When** an authorized user rejects it and provides a required reason,
   **Then** the system records the rejection and reason, updates local status,
   and attempts the authority-side reject/decline action when applicable.
3. **Given** a document was already accepted or rejected (terminal buyer
   decision), **When** a user tries the same or opposite action again,
   **Then** the system refuses the duplicate action and explains the current
   status.
4. **Given** accept or reject is performed, **When** an auditor reviews the
   audit log, **Then** they see actor, organization, document identity, action,
   outcome, and timestamp (no secrets).

---

### User Story 3 - Download the official PDF printout (Priority: P2)

The accountant needs the authority PDF printout for a received purchase or
purchase return for filing or sharing with finance.

**Why this priority**: High day-to-day value but secondary to sync and
accept/reject; depends on having a stored received document with authority
identity.

**Independent Test**: From a synced received document that has an authority
document identity, download PDF and open/save a valid PDF file.

**Acceptance Scenarios**:

1. **Given** a received document has been synced and has the identifiers needed
   for printout retrieval, **When** the user chooses "Download PDF", **Then**
   the system retrieves the printout and the user receives a PDF file.
2. **Given** PDF retrieval fails (authority error or missing identity),
   **When** the user attempts download, **Then** they see a clear error and the
   Purchases screen remains usable.

---

### User Story 4 - Reconcile purchases for bookkeeping review (Priority: P2)

Finance marks received purchases and purchase returns as **pending review**,
**reconciled**, or **disputed**, optionally with a short note, so the team can
track which inbound documents have been reviewed. Matching received documents
to local purchase orders is **out of scope for this release**; the product only
keeps reserved hooks so a later feature can add PO matching without reworking
this status model.

**Why this priority**: Explicitly requested; valuable for AP workflows, but
scoped so it does not block the inbound sync MVP or invent PO matching early.

**Independent Test**: Change reconciliation status on a purchase and a purchase
return, filter the list by reconciliation status, and confirm the note and
status persist after reload. Confirm there is no PO-match UI or requirement.

**Acceptance Scenarios**:

1. **Given** a synced purchase or purchase return, **When** an authorized user
   sets reconciliation to reconciled or disputed (with optional note),
   **Then** the status and note are stored and visible on list and detail.
2. **Given** documents in mixed reconciliation states, **When** the user
   filters by reconciliation status, **Then** only matching rows appear.
3. **Given** a reconciliation change, **When** audit is reviewed, **Then** the
   change is recorded with actor, prior and new status, and timestamp.
4. **Given** this release, **When** a user views Purchases, **Then** they are
   not required to select or match a purchase order to complete reconciliation.

---

### User Story 5 - Branch-scoped browsing of purchases (Priority: P3)

Organizations that operate multiple branches assign or filter received documents
by branch so each location sees relevant purchases. Documents may remain
unassigned until a user sets a branch.

**Why this priority**: Improves multi-branch usability; inbound authority data
often lacks a perfect branch mapping, so assignment is allowed rather than
blocking sync.

**Independent Test**: Assign a purchase to a branch, filter Purchases by that
branch, and confirm documents for other branches (or unassigned) are excluded.

**Acceptance Scenarios**:

1. **Given** multiple active branches, **When** the user filters Purchases by
   branch, **Then** only documents assigned to that branch (plus rules for
   “unassigned” if selected) are shown.
2. **Given** a synced document with no branch, **When** an authorized user
   assigns a branch, **Then** the assignment is stored and reflected in filters.

---

### Edge Cases

- Authority returns no new documents: sync completes successfully with
  zero new/updated counts.
- Partial sync failure (some pages or documents fail): successful items are
  kept; failures are summarized; sync can be retried without duplicating
  already-stored documents (idempotent upsert by **document uuid**).
- Same document appears in both “recent” and “search” pulls: one stored
  record is updated, not duplicated (**same uuid**).
- Received document missing uuid: not inserted as a purchase; counted in the
  sync failure/skipped summary until a later pull provides a uuid.
- Document type other than invoice or credit note appears in received
  results: stored if pulled for completeness (and uuid present), but
  classified as **other received** and excluded from the default Purchases
  type filters unless the user explicitly includes “other”.
- Accept/reject attempted while ETA credentials are missing or invalid: action
  is blocked with a clear configuration error.
- Accept/reject while the authority reports the document is no longer
  actionable: local status shows needs attention with the authority message.
- Concurrent accept and reject by two users: only one decision wins;
  the other receives a conflict explanation.
- PDF requested before the document has an authority long id / uuid: download
  is unavailable with an explanation.
- Tenant A must never see tenant B’s received documents, including via sync
  jobs, filters, PDF, or accept/reject.
- Scheduled (cron) sync overlaps an on-demand **"Sync now"** for the same
  tenant: only one sync runs at a time; the other waits or is skipped with a
  clear “sync already running” outcome.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST pull **received** documents for an organization from
  the tax authority using both **search documents** and **get recent documents**
  capabilities with direction = received. Sync MUST be triggerable by
  **scheduled cron** and by manual **"Sync now"**; both use the same pipeline.
- **FR-002**: System MUST classify received document types as: Invoice →
  **purchase invoice**; Credit Note → **purchase return**; other received types
  → **other received** (not presented as purchases by default).
- **FR-003**: System MUST persist received-document details needed for list and
  detail views: issuer, receiver snapshot as provided by the authority,
  identifiers (**document uuid** required for storage; internal id and long id
  when present), issue datetime, type and version, line items, taxes, totals,
  raw authority payload snapshot, and last sync time—scoped to the organization.
- **FR-004**: System MUST upsert received documents by **authority document
  uuid**, with tenant-scoped uniqueness `(tenant, documentUuid)`, so repeated
  syncs and overlapping search/recent results never create duplicates. Documents
  lacking a uuid MUST NOT be stored as purchases and MUST be reflected in the
  sync failure/skipped counts.
- **FR-005**: System MUST provide a Purchases module UI listing purchase
  invoices and purchase returns with filters for **date range**, **branch**,
  **type** (purchase invoice / purchase return / other when opted in), and
  **status** (including buyer decision and reconciliation dimensions as
  exposed in the UI).
- **FR-006**: System MUST provide a detail view for a single received document
  with full stored content and current statuses.
- **FR-007**: Authorized users MUST be able to **accept** an eligible received
  document; the system MUST attempt the corresponding authority-side buyer
  accept action when the document is eligible, and MUST record local outcome
  and audit.
- **FR-008**: Authorized users MUST be able to **reject** an eligible received
  document with a **required reason**; the system MUST attempt the
  corresponding authority-side reject/decline action when eligible, and MUST
  record local outcome, reason, and audit.
- **FR-009**: System MUST prevent conflicting or duplicate terminal buyer
  decisions on the same document version/identity.
- **FR-010**: Authorized users MUST be able to download the authority **PDF
  printout** for a received document when identifiers allow retrieval.
- **FR-011**: Authorized users MUST be able to set **reconciliation status** to
  at least: pending review, reconciled, disputed—with an optional note—and
  filter by that status. Matching to local purchase orders is **out of scope**
  in this release; the system MUST retain **hooks** (reserved linkage fields /
  extension points) so a future release can match purchases to local POs
  without breaking this model.
- **FR-012**: System MUST support optional **branch assignment** on received
  documents and filtering by branch (including unassigned).
- **FR-013**: Scheduled sync MUST run on a **cron** schedule whose enablement
  and interval are environment configuration (not hardcoded). Manual **"Sync
  now"** MUST be available from the Purchases UI for authorized users and MUST
  share the same pull/upsert pipeline as the cron job.
- **FR-014**: Sync and buyer actions MUST use the organization’s configured
  ETA environment (sandbox/preprod in non-production) and credentials; failures
  MUST surface actionable errors without exposing secrets.
- **FR-015**: All sync runs, accept, reject, reconciliation changes, branch
  assignments, and PDF download requests MUST be auditable (actor or system,
  tenant, action, outcome, timestamp).
- **FR-016**: Access to Purchases list, detail, sync, accept/reject,
  reconciliation, and PDF MUST require appropriate permissions (view vs
  manage); least privilege applies.
- **FR-017**: Received-document data MUST be tenant-isolated; background sync
  jobs MUST run in a single-tenant context per job and MUST NOT cross tenants.
- **FR-018**: Purchases UI MUST be available in Arabic and English with correct
  RTL for Arabic, using the existing design system and responsive layouts.
- **FR-019**: System MUST show sync progress/result (last successful sync time
  and last error summary) in the Purchases module.
- **FR-020**: Outgoing (issued) documents remain outside this module’s primary
  lists; Purchases is for **received** direction only.
- **FR-021**: Out of scope for this release: automatic or manual matching of
  received documents to local purchase orders, goods receipts, or ERP AP
  invoices—beyond reserved reconciliation hooks (FR-011).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios above are testable;
  sync, accept, reject, reconciliation, and PDF actions produce audit events
  with actor/system, tenant, outcome.
- **CC-002 Security**: ETA credentials remain encrypted at rest and never
  appear in UI, logs, or client bundles; buyer actions and sync use
  server-side credential access only; TLS for external calls.
- **CC-003 Tenant Isolation**: Received documents and sync state are
  tenant-scoped; RLS (or equivalent defense in depth) applies; jobs set tenant
  context per organization.
- **CC-004 ETA Serialization**: N/A for inbound pull/accept/reject/PDF—this
  feature does not create or re-sign issued document payloads. (Outbound
  canonical serialization unchanged.)
- **CC-005 Runtime ETA Config**: Document search/recent endpoints, accept/
  reject, and PDF URLs MUST come from environment/runtime ETA configuration;
  no production/sandbox URLs hardcoded in source for live calls.
- **CC-006 Sandbox-First**: Non-production sync and buyer actions target
  sandbox/preprod by default; production is a separate explicit environment.
- **CC-007 UX/i18n**: Purchases module ships ar/en via next-intl, RTL for
  Arabic, responsive layout, shared design system.
- **CC-008 Full-Stack Phase**: Backend sync/jobs/APIs and Frontend Purchases
  module ship together with automated tests covering acceptance criteria.

### Key Entities *(include if feature involves data)*

- **Received Document (Purchase record)**: Tenant-scoped inbound document from
  the authority; **document uuid** (unique per tenant, upsert key);
  classification (purchase invoice / purchase return / other); other authority
  identifiers (internal id, long id when present); issuer snapshot; financial
  summary; raw payload snapshot; local buyer decision status; reconciliation
  status and note; **reserved PO-match linkage hook** (unused in this release);
  optional branch assignment; last sync metadata.
- **Received Document Line**: Line-level detail (description, codes, qty,
  prices, taxes) stored for detail view and future AP use.
- **Sync Run**: Per-tenant record of a **cron** or **"Sync now"** pull:
  started/ended, trigger type, counts (fetched/new/updated/failed/skipped),
  error summary.
- **Buyer Decision**: Accept or reject action tied to a received document,
  reason (for reject), actor, timestamps, authority call outcome.
- **Branch** (existing): Optional organizational assignment for filtering
  received documents.
- **Purchase Order** (future): Not managed in this release; only a reserved
  linkage hook on the received document for a later matching feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authorized user can complete an on-demand sync and see newly
  available purchase invoices and purchase returns in the list within **2
  minutes** of starting sync under normal sandbox conditions (excluding
  authority outages).
- **SC-002**: Users can find a known received document using date + type +
  status filters in under **1 minute**.
- **SC-003**: Accept or reject (with reason) can be completed from detail view
  in under **1 minute**, with immediate local status feedback.
- **SC-004**: PDF download succeeds for **≥95%** of eligible documents that
  already have authority printout identity in sandbox tests (failures show a
  clear error).
- **SC-005**: **100%** of automated tenant-isolation checks confirm tenant A
  cannot list, open, sync-into, accept/reject, or download PDF for tenant B’s
  received documents.
- **SC-006**: Repeated sync of the same authority documents (cron and/or Sync
  now, search and/or recent) produces **zero duplicate** purchase records for
  the same **document uuid** within a tenant.
- **SC-007**: Arabic and English Purchases screens are usable end-to-end
  (list, filter, detail, accept/reject, PDF) without missing critical labels.

## Assumptions

- “Reconciliation” in this release means a **local review workflow** (pending /
  reconciled / disputed + optional note). **Matching against local purchase
  orders is deferred**; this release only keeps reserved hooks for that future
  feature.
- Receiver-side **accept/reject** means the buyer actions deferred from the
  Submission Pipeline feature for **inbound** documents (authority APIs for
  accept / reject / decline as applicable to received documents)—not cancel of
  documents this organization **issued**.
- Sync triggers are exactly **cron (scheduled)** and **manual "Sync now"**;
  default cron interval is on the order of **15 minutes**, configurable per
  environment; tenants without valid ETA credentials skip sync with a clear
  status.
- Dedupe key is **document uuid** only (tenant-scoped). Missing uuid ⇒ skip
  store, count as failed/skipped in the sync summary.
- Received **debit notes** and other non-invoice/non-credit types may be stored
  when returned by pull APIs (uuid present) but are **out of primary Purchases
  UX** unless the user opts into “other received”.
- Branch mapping is **manual or rule-light** in v1 (user assignment / filter);
  automatic mapping from issuer address or activity code is out of scope.
- Permissions reuse the product’s existing auth model with dedicated purchase
  view/manage capabilities (or equivalent documents permissions if product
  prefers a single documents permission set—implementation chooses the least
  surprise mapping during planning).
- PDF printout uses the same authority printout capability already envisioned
  for issued documents, applied to received document identities.
- This feature does **not** create, sign, or submit **outgoing** invoices; it
  consumes received documents only.
- Multi-document bulk accept/reject may be deferred after single-document
  actions if needed for schedule; single-document accept/reject is mandatory
  for MVP.
