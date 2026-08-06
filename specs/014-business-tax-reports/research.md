# Research: Business Tax Reports

**Feature**: `014-business-tax-reports` | **Date**: 2026-08-06

## Decisions

### 1. Live aggregation (no report rollup tables)

**Decision**: Compute reports on read from `documents` / `received_documents`
(+ lines/taxes) under TenantPrisma/RLS.

**Rationale**: Financial reports must match operational invoice data; status
and amounts change; separate rollups would duplicate Analytics complexity and
risk drift.

**Alternatives rejected**: Daily money rollups (billing-style); materialized
views (ops overhead for MVP).

### 2. Netting signs

**Issued (`DocumentKind`)**:
- `INVOICE`, `EXPORT_INVOICE`, `DEBIT_NOTE`, `EXPORT_DEBIT_NOTE` → **+1**
- `CREDIT_NOTE`, `EXPORT_CREDIT_NOTE` → **−1**

**Received**:
- `PURCHASE_INVOICE` → **+1**
- `PURCHASE_RETURN` → **−1**
- `OTHER_RECEIVED`: map from `etaDocumentType` (`I`/`EI` → +1, `C`/`EC` → −1,
  `D`/`ED` → +1); unknown → +1

**Amount field**: use `totalAmount` for sales/purchase totals; for VAT use
`taxTotalsJson` (issued) / line `taxesJson` or summary taxes (received),
applying the same document sign to each tax amount.

### 3. Default status filters

**Sales money**: `DocumentStatus.VALID` only unless `includeNonFinancialStatuses`.

**Purchases money**: `etaStatus` case-insensitive `Valid`; exclude
`buyerDecision = REJECTED` under default rules. C3 counts status buckets
without requiring VALID-only.

### 4. VAT vs withholding

**NET VAT / S4 VAT total / P3 VAT total**: tax type **`T1`** only
(`ETA_VAT_TAX_TYPE` from eta-core).

**Separate section**: `T4` (withholding) and any other non-T1 tax types
aggregated by type/rate, never added into C1 net.

### 5. Currency

**Modes**: (a) filter to one `currencyCode`; (b) `perCurrency=true` returns
rows grouped by currency with no cross-currency sum. MVP ships (a)+(b).
Chosen reporting-currency conversion deferred unless tenant rates exist;
otherwise 400 with clear message.

### 6. Gross vs net

Default responses include **net** totals. When `showGross=true`, also return
gross components: sum of positive-sign docs, sum of credit reductions, and net.

### 7. C1 per-branch

Optional `perBranch=true`: rows per `branchId` (sales branch; purchases use
`received.branchId`, unassigned → `null` / “Unassigned”) plus `total` row.
Branch nets MUST sum to tenant net for same filters.

### 8. Exports

CSV/XLSX for all; PDF for S1, P1, S4, P3, C1. Sync for typical sizes.

### 9. Permissions

`reports.view`, `reports.export` — Owner, Admin, Accountant. Viewer none.

### 10. Agent / signing

Out of scope. SELECT-only Prisma reads.
