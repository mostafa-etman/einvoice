# Feature Specification: Business Tax Reports

**Feature Branch**: `014-business-tax-reports`

**Created**: 2026-08-06

**Status**: Implemented

**Input**: User description: "Add a Reports module that lets the client ANALYZE their business (sales, purchases, and combined) — business/tax reporting DISTINCT from Phase 10 usage analytics. Build reports from issued (sales) and received (purchases) documents, tenant-scoped with RLS, filterable by date range, branch, currency, document type, and status. Ten reports (S1–S4, P1–P3, C1–C3) with credit/debit note netting, per-branch NET VAT on C1, VAT vs withholding separation, exports, Accountant access, Arabic/English + RTL."

## Clarifications

### Session 2026-08-06 (approved catalog adjustments)

- Credit/debit **netting is the default** across all sales, purchase, and VAT money figures: Sales = invoices − credit notes + debit notes (same for purchases and VAT). Optional **gross vs net** display.
- C1 **NET VAT** supports optional **per-branch breakdown** (each branch output − input, plus tenant total).
- C1 counts only VALID/accepted documents; includes credit/debit with correct sign; **VAT (T1) only** in the net position; withholding (T4) and other non-VAT taxes reported separately; shows period, components, and payable vs refundable.

## Distinction from Usage Analytics

This feature analyzes **invoice financial data** (amounts, VAT, customers, suppliers, items) for business and tax reporting. It MUST NOT reuse or extend the Phase 10 usage-analytics meters (`issued`, `received`, `api_calls`, `storage_bytes`, etc.). Navigation and copy MUST keep **Reports** (business/tax) separate from **Analytics** (system usage).

## Report Catalog

### Sales (issued documents)

| ID | Report | Purpose |
|----|--------|---------|
| S1 | Total sales over period | Netted sales with day/month breakdown |
| S2 | Sales by customer | Top receivers by netted amount |
| S3 | Sales by item/product | Netted sales by item code/name |
| S4 | Output VAT summary | VAT collected on sales by tax type/rate (VAT separate from withholding) |

### Purchases (received documents)

| ID | Report | Purpose |
|----|--------|---------|
| P1 | Total purchases over period | Netted purchases with day/month breakdown |
| P2 | Purchases by supplier | Top issuers by netted amount |
| P3 | Input VAT summary | Deductible VAT on purchases by tax type/rate |

### Combined (tax focus)

| ID | Report | Purpose |
|----|--------|---------|
| C1 | NET VAT position | Output VAT − input VAT = payable/refundable; optional per-branch |
| C2 | Sales vs purchases over time | Netted comparison series |
| C3 | Document status overview | Issued: valid/invalid/cancelled; Received: accepted/rejected |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - NET VAT position for the tax period (Priority: P1)

An Owner, Admin, or Accountant opens Reports → Combined → NET VAT for a chosen period and sees **output VAT (sales)**, **input VAT (purchases)**, and **net VAT** labeled as **payable** (positive) or **refundable** (negative/zero per product rules). Figures use only VALID issued and accepted received documents, net credit/debit notes with correct sign, and include **VAT (T1) only**. Withholding and other non-VAT taxes appear in a separate section, never inside the net VAT figure. Optionally they expand **per-branch** rows showing each branch’s output − input plus the tenant total.

**Why this priority**: This is the primary tax report clients need for ETA/accountant work; accuracy errors here are business-critical.

**Independent Test**: Seed a known mix of valid invoices, credit notes, debit notes (sales and purchases) with T1 and T4 lines; compute net VAT by hand; open C1 for that period and confirm components and net match; confirm T4 is excluded from net and shown separately; enable per-branch and confirm branch rows sum to the tenant total.

**Acceptance Scenarios**:

1. **Given** valid issued sales with T1 VAT and accepted purchases with T1 VAT in a period, **When** the user opens C1 for that period, **Then** net VAT = netted output VAT − netted input VAT, with period, components, and payable/refundable shown.
2. **Given** credit and debit notes among those documents, **When** C1 is viewed, **Then** output and input VAT reflect invoices − credit notes + debit notes (not a gross invoice-only sum).
3. **Given** documents with T4 withholding, **When** C1 is viewed, **Then** net VAT excludes T4; withholding appears only in the separate non-VAT section.
4. **Given** cancelled, invalid, or rejected documents in the period, **When** C1 is viewed (default status rules), **Then** those documents do not contribute to output VAT, input VAT, or net.
5. **Given** activity in multiple branches, **When** the user enables per-branch breakdown, **Then** each branch shows output VAT, input VAT, and net, and the sum of branch nets equals the tenant total (for the same filters).
6. **Given** a Viewer (or any user without reports permission), **When** they open Reports, **Then** access is denied.

---

### User Story 2 - Sales reports with credit/debit netting (Priority: P1)

An authorized user runs sales reports S1–S4 for a period. Default financial figures are **netted**: invoices reduce by credit notes and increase by debit notes (including export variants). They can optionally view **gross vs net**. Filters cover date range, branch, currency, document type, and status (default financial status: VALID only; optional include others). Each report shows a clear table and a chart where useful, and can be exported.

**Why this priority**: Without netting, sales and output VAT are overstated; accountants cannot trust the numbers.

**Independent Test**: For a period with invoices, credit notes, and debit notes, verify S1 total sales = invoices − credit notes + debit notes; verify S4 output VAT uses the same netting; spot-check S2/S3 rankings against netted document lines.

**Acceptance Scenarios**:

1. **Given** issued invoices totaling 1000, credit notes 200, debit notes 50 (same currency, VALID), **When** S1 is run for that period, **Then** netted sales = 850, and day/month breakdown uses the same netting.
2. **Given** the same documents, **When** the user enables gross vs net, **Then** gross (invoice+debit without credit reduction, or product-defined gross columns) and net are both visible without changing the default net figure used elsewhere.
3. **Given** multiple customers and items, **When** S2 and S3 are run, **Then** rankings and amounts use netted contributions.
4. **Given** mixed T1 and T4 tax lines, **When** S4 is run, **Then** output VAT summary groups VAT by type/rate and keeps withholding out of VAT totals (shown separately if included in that report’s tax breakdown).

---

### User Story 3 - Purchase reports with netting (Priority: P1)

An authorized user runs purchase reports P1–P3 on received documents. Totals and input VAT net received credit/debit (or return) notes the same way as sales. Filters and export behavior match the shared report conventions.

**Why this priority**: Input VAT and purchase totals feed C1; they must use the same netting rules.

**Independent Test**: Seed accepted purchases with invoice and return/credit documents; confirm P1 and P3 match hand calculation; confirm C1 input VAT equals P3 netted input VAT for the same filters.

**Acceptance Scenarios**:

1. **Given** accepted purchase invoices and credit/return notes, **When** P1 is run, **Then** netted purchases = invoices − credit/returns + debit (if applicable).
2. **Given** the same set, **When** P2 is run, **Then** supplier rankings use netted amounts.
3. **Given** T1 on purchases, **When** P3 is run, **Then** input VAT is by tax type/rate, withholding separate, and matches what C1 uses as input VAT for the same period/filters.

---

### User Story 4 - Sales vs purchases and status overview (Priority: P2)

An authorized user views C2 (sales vs purchases over time) and C3 (document status overview) to understand volume and health alongside tax figures. C2 uses netted sales and purchases. C3 counts by status buckets (issued: valid/invalid/cancelled; received: accepted/rejected) and is not required to apply money netting.

**Why this priority**: Supports operational and tax context but is secondary to money-accurate VAT and sales/purchase totals.

**Independent Test**: Confirm C2 series match S1 and P1 period totals when aggregated; confirm C3 status counts match document lists under the same filters.

**Acceptance Scenarios**:

1. **Given** activity over several months, **When** C2 is viewed monthly, **Then** sales and purchases series reflect netted totals per bucket.
2. **Given** a mix of statuses, **When** C3 is viewed, **Then** issued and received status counts match the underlying filtered documents.

---

### User Story 5 - Filter, chart, export, and share with accountant (Priority: P2)

For every report, the user applies shared filters, sees a table (and chart where useful), and exports to **CSV** and **XLSX**; **PDF** is available for S1, P1, S4, P3, and C1 (accountant-oriented packs). Exports respect the same filters, netting defaults, and tenant isolation. All UI is Arabic/English with RTL and responsive layout. A **Reports** item appears in the app nav, distinct from Analytics.

**Why this priority**: Delivery and shareability complete the accountant workflow once numbers are trusted.

**Independent Test**: Export C1 and S1 for a known period; open files and confirm totals match on-screen; switch locale to Arabic and confirm layout/RTL; confirm Viewer cannot export.

**Acceptance Scenarios**:

1. **Given** an authorized user on any of the ten reports, **When** they change date range, branch, currency, document type, or status include-others, **Then** table and chart refresh consistently.
2. **Given** C1 (or S1/P1/S4/P3), **When** they export PDF, **Then** the file includes period, components/totals, and tenant identification suitable for an accountant.
3. **Given** any report, **When** they export CSV or XLSX, **Then** row totals match the on-screen netted figures for the same filters.
4. **Given** locale `ar`, **When** Reports is opened, **Then** labels are Arabic and layout is RTL-safe on mobile and desktop.

---

### Edge Cases

- Empty period: show zero totals and empty series/tables without errors; exports still generate valid empty/header-only files.
- Multi-currency: user chooses a single reporting currency **or** views per-currency breakdown; money math never silently mixes currency units.
- Documents missing tax lines: contribute zero to VAT summaries; still count in sales/purchase totals where amount exists.
- Export invoice / export credit / export debit kinds: participate in sales netting with the same sign rules as domestic invoice/credit/debit.
- Branch filter + C1 per-branch: if a single branch is filtered, per-branch breakdown shows that branch (and total equals that branch).
- Draft/unsigned documents: excluded from default financial figures (not VALID/accepted).
- Extremely large result sets: reports remain usable (pagination or top-N for ranking reports; full export may be async if needed).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a tenant-scoped Reports module with ten reports: S1–S4, P1–P3, C1–C3 as defined in the Report Catalog, distinct from usage Analytics.
- **FR-002**: All report queries MUST enforce tenant isolation (application tenant context + RLS on underlying tenant-scoped document data). Reports MUST be read-only and MUST NOT alter documents, signatures, or submission state.
- **FR-003**: Access MUST require explicit permissions: `reports.view` to view reports; `reports.export` to export. Default grants: Owner, Admin, and Accountant have both; Viewer has neither.
- **FR-004**: Shared filters MUST include date range, branch, currency mode (chosen currency or per-currency), document type, and status. Default money figures MUST include only VALID issued documents and accepted received documents; an explicit option MUST allow including other statuses.
- **FR-005**: Credit/debit note **netting MUST be the default** for all sales, purchase, and VAT money figures: invoices (and export invoices) contribute positively; credit notes (and export credit notes / purchase returns) reduce; debit notes (and export debit notes) increase. Users MUST be able to optionally view gross vs net.
- **FR-006**: S1 MUST show netted total sales for the period with day or month breakdown, table + chart, and export CSV/XLSX/PDF.
- **FR-007**: S2 MUST rank sales by customer/receiver using netted amounts (table + chart, CSV/XLSX).
- **FR-008**: S3 MUST aggregate sales by item/product using netted amounts (table + chart, CSV/XLSX).
- **FR-009**: S4 MUST summarize output VAT by tax type/rate; VAT MUST NOT mix with withholding (T4) or other non-VAT taxes (those shown separately). Export CSV/XLSX/PDF.
- **FR-010**: P1 MUST show netted total purchases with day/month breakdown (table + chart, CSV/XLSX/PDF).
- **FR-011**: P2 MUST rank purchases by supplier/issuer using netted amounts (table + chart, CSV/XLSX).
- **FR-012**: P3 MUST summarize input (deductible) VAT by tax type/rate with withholding separated (CSV/XLSX/PDF).
- **FR-013**: C1 MUST compute NET VAT = netted output VAT − netted input VAT for the period; show period, output VAT, input VAT, net, and payable vs refundable; count only VALID/accepted under default rules; include credit/debit with correct sign; include VAT (T1) only in the net position; report withholding/other taxes separately; support optional per-branch breakdown whose branch nets sum to the tenant total. Export CSV/XLSX/PDF.
- **FR-014**: For the same filters, C1 output VAT MUST equal S4 netted VAT total and C1 input VAT MUST equal P3 netted VAT total (identity for acceptance).
- **FR-015**: C2 MUST compare netted sales vs purchases over time (table + chart, CSV/XLSX).
- **FR-016**: C3 MUST show document status overview for issued (valid/invalid/cancelled) and received (accepted/rejected) (table + chart, CSV/XLSX).
- **FR-017**: All monetary aggregation MUST use the shared money utility; multi-currency handling MUST be explicit (chosen reporting currency or per-currency rows — never opaque mixed-currency sums).
- **FR-018**: UI MUST support English and Arabic, RTL for Arabic, and responsive layout; app navigation MUST include a Reports section.
- **FR-019**: Export actions and report views that are security/business relevant SHOULD be audit-logged (actor, tenant, report id, filters summary, outcome) without logging secrets.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios cover netting and C1 identity; automated tests MUST verify S1 netting and C1 = S4 − P3 against seeded documents; report view/export audit events.
- **CC-002 Security**: Permission-gated view/export; no secrets in exports or client bundles; TLS unchanged.
- **CC-003 Tenant Isolation**: All report reads via tenant context + RLS on documents/purchases; cross-tenant leakage is release-blocking.
- **CC-004 ETA Serialization**: N/A — read-only reporting; MUST NOT change signing/canonical serialization.
- **CC-005 Runtime ETA Config**: N/A — no new hardcoded ETA URLs/schemas.
- **CC-006 Sandbox-First**: N/A — no new ETA live calls required for reporting (uses stored document data).
- **CC-007 UX/i18n**: ar/en + RTL + responsive Reports UI; clear separation from Analytics labeling.
- **CC-008 Full-Stack Phase**: Backend report APIs + Web Reports UI (+ exports) delivered together; agent unchanged.

### Key Entities *(include if feature involves data)*

- **Issued document (sales source)**: Tenant-scoped outbound document with kind (invoice / credit / debit / export variants), status, branch, currency, receiver, lines, tax totals, issue/date fields used for period filtering.
- **Received document (purchase source)**: Tenant-scoped inbound/purchase document with kind/decision/status, issuer (supplier), branch, currency, amounts, tax lines, and dates.
- **Report filter set**: Date range, branch, currency mode, document type, status inclusion, netting/gross toggle, grain (day/month), optional per-branch for C1.
- **Report result**: Tabular rows + optional series for charts + summary totals (net and optional gross) + metadata (period, currency, payable/refundable for C1).
- **Report export artifact**: CSV/XLSX/(PDF where required) generated from the same result the user sees.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a seeded test period with invoices and credit/debit notes, S1 netted sales equals invoices − credit notes + debit notes within 1 minor currency unit of a hand calculation.
- **SC-002**: For the same period and filters, C1 net VAT equals netted output VAT (S4) minus netted input VAT (P3), matching underlying documents by hand within 1 minor unit; T4 excluded from that net.
- **SC-003**: With per-branch C1 enabled, the sum of branch net VAT equals the tenant-level net VAT for the same filters.
- **SC-004**: Authorized Accountant/Owner/Admin can open all ten reports and export at least one CSV and one PDF for C1 in under 3 minutes without leaving the Reports module.
- **SC-005**: A second tenant’s documents never appear in another tenant’s report or export (100% isolation in cross-tenant tests).
- **SC-006**: Arabic locale shows Reports with correct RTL layout on a mobile-width viewport without horizontal clipping of primary filters and primary totals.
- **SC-007**: Running any report does not change document status, signature, or submission state (zero write side effects on document tables in tests).

## Assumptions

- “Accepted” received documents means the product’s buyer-accepted / authority-accepted status used elsewhere in Purchases (same canonical status set as operational lists).
- VAT tax type for net position is **T1** (and rate breakdowns under VAT types); **T4** is withholding and never part of NET VAT; other tax types follow the same “VAT vs non-VAT” separation in summaries.
- Purchase returns / credit-like received kinds reduce purchase totals and input VAT analogously to issued credit notes.
- Gross vs net optional view shows additional columns or a toggle; default remains net for all money figures and for C1.
- Currency conversion to a chosen reporting currency, if offered, uses tenant-configured rates available in the product; if rates are missing, the system reports per-currency rather than inventing rates.
- PDF export is required for S1, P1, S4, P3, and C1; other reports may offer CSV/XLSX only in v1.
- Phase 10 Analytics remains unchanged; no merging of nav entries or data pipelines.
- Desktop signing agent is out of scope (read-only reporting).
