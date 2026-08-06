# Feature Specification: Usage Analytics & Metering

**Feature Branch**: `011-usage-analytics`

**Created**: 2026-08-01

**Status**: Clarified

**Input**: User description: "Feature: Usage analytics & metering.
- Per-tenant metering: issued/received documents, valid/invalid counts, API usage, storage. Aggregate for dashboards; export reports; structure it to feed billing later.
Frontend: analytics dashboards (charts, filters by branch/period/currency)."

## Clarifications

### Session 2026-08-01

- Q: How is metering captured and aggregated for dashboards and billing readiness?
  → A: **Event log** of usage events, aggregated into **daily** and **monthly**
  rollups (dashboards and exports read rollups; raw events remain the source
  trail for rebuild/reconciliation).
- Q: What are the canonical meter identifiers?
  → A: **`issued`**, **`received`**, **`valid`**, **`invalid`**,
  **`api_calls`**, **`storage_bytes`** (exact identifiers for facts, rollups,
  dashboards, and exports).
- Q: Which export formats MUST be supported?
  → A: **Both CSV and XLSX** (user chooses format on export).
- Q: How should `storage_bytes` be recorded in the event log?
  → A: **Absolute snapshot (gauge)** — each event stores current total
  `storage_bytes` for the org; daily/monthly rollup = latest/end-of-period
  total (planning default for unanswered clarify Q4; aligns with recommended
  Option A).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View organization usage on an analytics dashboard (Priority: P1)

An Owner or Admin opens Analytics and sees a clear summary of their
organization’s usage for a chosen period from **daily/monthly rollups** built
from the usage **event log**: **`issued`**, **`received`**, **`valid`**,
**`invalid`**, **`api_calls`**, and **`storage_bytes`**. Charts show trends
over time. Filters let them narrow by **branch**, **period**, and **currency**
where the metric is currency-scoped (document counts and monetary totals).
Numbers match the organization’s operational reality and never include another
tenant’s data.

**Why this priority**: Visibility into usage is the core product value of this
feature; without a trustworthy dashboard, metering and exports have no user
face.

**Independent Test**: With known issued/received/valid/invalid activity in one
organization (and different activity in another), open Analytics for a period,
apply branch and currency filters, and confirm charts and totals match expected
counts and exclude other organizations.

**Acceptance Scenarios**:

1. **Given** an authorized user in an organization with document and purchase
   activity, **When** they open the Analytics dashboard for a default recent
   period, **Then** they see rollup totals for `issued`, `received`, `valid`,
   `invalid`, `api_calls`, and `storage_bytes` for that organization only.
2. **Given** activity across multiple branches, **When** they filter by one
   branch, **Then** document-related metrics reflect only that branch (and
   tenant-wide metrics that are not branch-scoped remain clearly labeled as
   organization-level).
3. **Given** documents in more than one currency, **When** they filter by a
   currency, **Then** document counts and any monetary rollups for that view
   include only documents in that currency.
4. **Given** a chosen period (day/week/month/custom range within allowed
   limits), **When** they change the period, **Then** charts and totals refresh
   to that period without requiring a page reload that loses filter context.
5. **Given** a user without analytics-view permission, **When** they attempt to
   open Analytics, **Then** access is denied and no usage figures are shown.

---

### User Story 2 - Trust meter accuracy for issued, received, valid, and invalid (Priority: P1)

Operations and leadership rely on meters that track, per organization: outbound
**`issued`** documents, **`received`** purchase documents, and **`valid`** vs
**`invalid`** outcomes (authority or product validation outcome as defined for
each document flow). Each counted change appends to the usage **event log** and
flows into **daily/monthly rollups** so dashboards and exports stay aligned with
what users already see in Documents and Purchases.

**Why this priority**: Incorrect counts destroy trust and would poison future
billing; accuracy is non-negotiable.

**Independent Test**: Create a known mix of issued and received documents with
valid and invalid outcomes; refresh Analytics and confirm each meter matches
the operational lists for the same filters.

**Acceptance Scenarios**:

1. **Given** outbound documents that reach a counted issued state in the period,
   **When** Analytics is viewed for that period, **Then** the `issued` rollup
   equals the count of those documents under the same branch/currency filters.
2. **Given** received/purchase documents recorded in the period, **When**
   Analytics is viewed, **Then** the `received` rollup matches those documents
   under the same filters.
3. **Given** documents classified valid or invalid per product rules, **When**
   Analytics is viewed, **Then** `valid` and `invalid` rollups sum consistently
   with the documents included in the filtered set (no silent double-count
   across issued vs received unless the UI states a combined total).
4. **Given** a document that changes outcome (e.g. corrected after invalid),
   **When** corresponding usage events are recorded and rollups refresh, **Then**
   counts reflect the current authoritative outcome without inventing duplicate
   documents.

---

### User Story 3 - Meter API usage and storage per organization (Priority: P1)

The platform records **`api_calls`** attributable to the organization
(authenticated calls made in that tenant’s context) and **`storage_bytes`** for
retained artifacts (documents, printouts, import/export packages, and similar
stored objects) via the usage **event log** into **daily/monthly rollups**.
Dashboards show both as totals and period trends so owners can see growth and
spikes.

**Why this priority**: API and storage are the non-document dimensions called out
for metering and future billing; they must be visible and tenant-isolated from
day one.

**Independent Test**: Generate measurable API activity and store known artifacts
in one organization; confirm Analytics shows non-zero API and storage for that
organization only and that another organization does not see those figures.

**Acceptance Scenarios**:

1. **Given** authenticated API activity under an organization, **When** an
   authorized user views Analytics for a period covering that activity, **Then**
   `api_calls` for that organization increases accordingly and is filterable by
   period (branch/currency filters do not invent fake API splits; UI labels
   organization-level `api_calls` clearly).
2. **Given** stored artifacts belonging to the organization, **When** Analytics
   shows storage, **Then** `storage_bytes` reflects that organization’s retained
   storage and excludes other organizations.
3. **Given** artifacts are deleted or expire per product retention rules,
   **When** storage events/rollups next refresh, **Then** `storage_bytes`
   decreases accordingly (or stays accurate within the stated refresh cadence).

---

### User Story 4 - Export usage reports (Priority: P2)

An authorized user exports a usage report as **CSV or XLSX** for the current
dashboard filters (period, branch, currency as applicable) so they can share
with finance or keep an offline record. The export includes the same meters
shown on the dashboard (`issued`, `received`, `valid`, `invalid`, `api_calls`,
`storage_bytes`) with enough breakdown for the period to be understandable
offline.

**Why this priority**: Dashboards alone are not enough for finance and
governance; export closes the operational loop without waiting for billing.

**Independent Test**: Apply filters, export a report, open the file, and confirm
totals match the on-screen dashboard for those filters and contain only that
organization’s data.

**Acceptance Scenarios**:

1. **Given** an authorized user viewing Analytics with filters applied, **When**
   they request an export and choose CSV or XLSX, **Then** they receive a
   downloadable report in that format for those filters including the six core
   meters and period identity.
2. **Given** a completed export, **When** they compare key totals to the
   dashboard, **Then** figures match for the same filters (within documented
   rounding for storage units if any).
3. **Given** a user without export permission (or without analytics access),
   **When** they attempt export, **Then** the action is denied.
4. **Given** an export completes, **When** an auditor reviews the audit trail,
   **Then** they see who exported, which organization, which period/filters, and
   when.

---

### User Story 5 - Billing-ready usage facts without charging yet (Priority: P2)

Product and future billing need a durable trail: a per-organization **event
log** plus **daily and monthly rollups** for `issued`, `received`, `valid`,
`invalid`, `api_calls`, and `storage_bytes`, so a later billing feature can
price plans from rollups (reconciling to events when needed) without
re-deriving history solely from live operational tables. This feature does
**not** create invoices, collect payment, or show prices.

**Why this priority**: Structuring metering for billing later avoids a rewrite;
shipping charge UI now would expand scope beyond the request.

**Independent Test**: After known activity, confirm usage events and
daily/monthly rollups exist for each of the six meters, that dashboard totals
reconcile to those rollups, and that no charging or plan-price UI is required.

**Acceptance Scenarios**:

1. **Given** metered activity in an organization, **When** events are recorded
   and rollups materialize, **Then** daily and monthly rollups exist for each of
   `issued`, `received`, `valid`, `invalid`, `api_calls`, and `storage_bytes`
   with organization identity and time bucket.
2. **Given** rollups for a period, **When** Analytics is viewed for that
   period, **Then** dashboard totals can be explained by those rollups (same
   organization, same meters)—and rollups can be rebuilt from the event log if
   needed.
3. **Given** this release, **When** a user explores Analytics, **Then** they do
   not see invoicing, payment, or plan-charge workflows (billing consumption is
   future work).

---

### Edge Cases

- Empty period: dashboard shows zeros (or empty-state copy), not errors.
- Organization with no branches selected / “all branches”: totals include all
  branches the user is allowed to see within the tenant.
- Currency filter with no documents in that currency: document meters show zero;
  organization-level API/storage remain labeled as not currency-filtered.
- Very large tenants: dashboard remains usable (filters and charts load without
  appearing stuck beyond stated expectations in Success Criteria).
- Clock/period boundaries: documents near midnight or month-end appear in exactly
  one period bucket according to documented timezone rules (organization or
  product default).
- Partial permissions: user can view Analytics but not export → view allowed,
  export denied.
- Cross-tenant access attempts: always denied; no leakage in UI, export, or
  aggregates.
- Metric refresh lag: when rollups trail the event log, UI indicates data
  freshness (e.g. “as of” time).
- Rollup rebuild: if a daily/monthly rollup is missing or repaired, rebuilding
  from the event log MUST restore the same totals for unchanged events.

## Requirements *(mandatory)*

### Functional Requirements

**Metering**

- **FR-001**: System MUST meter, per organization (tenant), exactly these
  canonical meters: **`issued`**, **`received`**, **`valid`**, **`invalid`**,
  **`api_calls`**, **`storage_bytes`**.
- **FR-001a**: System MUST capture metering via a tenant-scoped **usage event
  log** and MUST aggregate events into **daily** and **monthly** rollups used by
  dashboards and exports (rollups MUST be rebuildable from the event log).
- **FR-002**: **`issued`** MUST mean outbound e-invoice/documents that entered
  the product’s counted issued state for the period (aligned with Documents
  operational definitions).
- **FR-003**: **`received`** MUST mean purchase/received documents recorded for
  the organization in the period (aligned with Purchases operational
  definitions).
- **FR-004**: **`valid`** and **`invalid`** MUST reflect the authoritative
  validation outcome for included documents (authority acceptance/rejection or
  the product’s equivalent final validation classification), and MUST be
  countable under the same filters as issued/received views.
- **FR-005**: **`api_calls`** MUST count authenticated platform API activity
  attributable to the organization (tenant context), recorded as events and
  rolled up by day/month for dashboards and exports.
- **FR-006**: **`storage_bytes`** MUST measure retained organization artifact
  volume in bytes (documents and related stored files the product keeps for the
  tenant); dashboards and exports MAY present human-readable units derived from
  bytes.
- **FR-007**: All meters, events, and rollups MUST be strictly tenant-scoped;
  one organization MUST NEVER see another’s usage.

**Aggregation & dashboards**

- **FR-008**: System MUST provide an Analytics dashboard that reads **daily /
  monthly rollups** (summary totals and time-series charts appropriate to the
  period).
- **FR-009**: Dashboard MUST support filters for **branch**, **period**, and
  **currency**. Branch and currency filters MUST apply to document-scoped
  meters (`issued`, `received`, `valid`, `invalid`); `api_calls` and
  `storage_bytes` MAY be organization-level and MUST be labeled so users are not
  misled.
- **FR-010**: Period filter MUST support at least common presets (e.g. today,
  last 7 days, month-to-date, previous month) and a custom date range within
  configured maximum span; chart grain MUST use daily rollups for short ranges
  and MAY use monthly rollups for longer ranges.
- **FR-011**: Dashboard MUST be available in Arabic and English with correct RTL
  for Arabic, and MUST follow the product design system and responsive layout.

**Exports**

- **FR-012**: Authorized users MUST be able to export a usage report for the
  current filters, including the six canonical meters and period/filter
  identity.
- **FR-013**: Export MUST support **both CSV and XLSX**; the user MUST be able
  to choose the format when requesting the download.

**Billing readiness (no charging)**

- **FR-014**: System MUST persist the **event log** and **daily/monthly
  rollups** for all six meters so a future billing feature can consume rollups
  (and reconcile to events) without re-deriving history solely from live
  operational tables.
- **FR-015**: This feature MUST NOT implement invoicing, payment collection,
  plan pricing UI, or charge calculation.

**Access, audit, isolation**

- **FR-016**: Access to Analytics view and usage export MUST be permission-gated;
  default seeded roles: Owner and Admin can view and export; Accountant and
  Viewer cannot unless granted the permission.
- **FR-017**: Viewing Analytics and exporting usage reports MUST write audit
  events (actor, organization, action, outcome, period/filters summary as
  applicable).
- **FR-018**: Tenant isolation MUST hold for usage events, rollups, dashboard
  responses, and exports (application checks + database tenant enforcement for
  tenant-scoped stores).

**Out of scope (this release)**

- **FR-019**: Out of scope: live billing/invoicing, payment gateways, plan
  catalogs and entitlements enforcement (hard caps that block work), anomaly
  ML, cross-organization marketplace benchmarks, and email-scheduled report
  delivery (manual export only).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios above map to automated
  tests; Analytics view and usage export produce audit events with actor,
  tenant, timestamp, action, and outcome.
- **CC-002 Security**: No secrets in analytics payloads or exports; least
  privilege via analytics permissions; TLS for all access as elsewhere.
- **CC-003 Tenant Isolation**: Usage events, rollups, dashboard data, and
  exports are tenant-scoped; RLS (or equivalent) on tenant-scoped metering
  stores; cross-tenant leakage is release-blocking.
- **CC-004 ETA Serialization**: N/A — feature does not change signing or
  canonical serialization.
- **CC-005 Runtime ETA Config**: N/A — no ETA URL/schema/credential hardcoding
  introduced.
- **CC-006 Sandbox-First**: N/A for metering itself; any environment-specific
  volume still uses non-prod configuration in non-prod.
- **CC-007 UX/i18n**: Analytics UI in ar/en with RTL, design system, responsive.
- **CC-008 Full-Stack Phase**: Backend metering/aggregation/export + Frontend
  Analytics dashboards ship together with tests.

### Key Entities *(include if feature involves data)*

- **Usage event**: An append-oriented, tenant-scoped log entry recording a
  metered change (or observation) for one canonical meter, with timestamp and
  dimensions needed for rollup (organization, optional branch, optional
  currency where applicable). Source of truth for rebuild.
- **Daily rollup / Monthly rollup**: Aggregates of usage events for a calendar
  day or month bucket per organization (and applicable dimensions). Primary
  read model for dashboards, exports, and future billing.
- **Canonical meters**: `issued`, `received`, `valid`, `invalid`, `api_calls`,
  `storage_bytes`.
- **Usage export**: A user-requested CSV or XLSX download for a filter set,
  tenant-scoped, auditable.
- **Organization (tenant)**: Isolation boundary for all metering and analytics.
- **Branch / Currency**: Filter dimensions for document-scoped meters; optional
  attributes on events/rollups where meaningful.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Authorized users can open Analytics and understand organization
  usage for a selected period in under 2 minutes without training beyond
  on-screen labels.
- **SC-002**: For a prepared test organization, issued, received, valid, and
  invalid dashboard totals match operational document/purchase lists for the
  same filters with 100% agreement on document identity counts.
- **SC-003**: `api_calls` and `storage_bytes` shown for an organization never
  include another organization’s activity in verification tests (0 cross-tenant
  leakage).
- **SC-004**: 95% of Analytics dashboard loads for typical filter sets return
  visible totals and charts within 3 seconds under normal product load
  expectations for the deployment class.
- **SC-005**: Authorized users can export usage as CSV and as XLSX and confirm
  key totals match the on-screen dashboard for the same filters on the first
  attempt in usability checks (≥90% success).
- **SC-006**: For each of the six meters, daily and monthly rollups exist such
  that a future billing feature could price a period from rollups, with the
  event log available to rebuild or reconcile those rollups, without
  re-scanning raw document rows as the only source of truth.
- **SC-007**: Arabic and English users can complete view and export flows with
  correct layout direction; no untranslated critical Analytics labels in either
  locale for shipped strings.

## Assumptions

- Target users are organization Owners/Admins (primary); Accountants/Viewers
  need an explicit permission grant to view or export.
- Canonical meters are exactly: `issued`, `received`, `valid`, `invalid`,
  `api_calls`, `storage_bytes`.
- Metering pipeline is **event log → daily rollups → monthly rollups** (monthly
  may be derived from daily); dashboards/exports prefer rollups over scanning
  the raw event log for every view.
- “Issued” aligns with outbound Documents that count as issued for operations;
  “Received” aligns with Purchases/received documents already in the product.
- Valid/Invalid use the same authoritative outcome users already interpret in
  Documents/Purchases/submission status (not a separate opaque score).
- `api_calls` means authenticated platform API calls in tenant context
  (integration and app API use), not a separate product for ETA’s own upstream
  call billing.
- `storage_bytes` means retained bytes the product stores for the tenant
  (documents, PDFs/packages, import/export artifacts as applicable), not
  endpoint device disk; recorded as **absolute gauge** snapshots (not
  delta-only).
- Aggregation lag from event to rollup is short (minutes); the UI may show a
  freshness indicator when lag exists.
- Period boundaries use a single documented timezone default for the product or
  organization setting if one already exists; no per-user timezone in v1.
- Currency filter applies to document meters and monetary rollups only;
  `api_calls` and `storage_bytes` remain organization-level.
- Export is on-demand **CSV and XLSX** (both required); scheduled email reports
  are out of scope.
- Billing, plan entitlements, hard usage caps that block issuing, and payment
  are explicitly out of scope; only event log, rollups, and analytics UX ship.
- Existing auth, RBAC, branches, currencies, documents, purchases, and audit log
  capabilities are reused.
- Historical backfill: from feature enablement forward is required; best-effort
  backfill of a limited recent window from operational data is desirable but
  not required for MVP if events/rollups start cleanly at go-live with
  documented cutover.
