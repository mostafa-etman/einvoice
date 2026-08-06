# Research: Usage Analytics & Metering

**Feature**: `011-usage-analytics` | **Date**: 2026-08-01

Resolves Technical Context choices from the clarified spec and user plan:
`UsageEvent` + daily/monthly rollups, analytics API/export, recharts
dashboard, exact-match totals tests. Encodes unanswered clarify Q4
(`storage_bytes`) as absolute gauge.

---

## R1 — Event log → daily/monthly rollups

**Decision**:
- Append-only **`UsageEvent`** rows (tenant-scoped) for each metered
  observation/change.
- **BullMQ** jobs (`usage-rollup`) materialize **`UsageDailyRollup`** then
  **`UsageMonthlyRollup`** (monthly derived from daily for the tenant/dims).
- Dashboards and exports **read rollups**; rebuild/reconcile from events.
- Rollup grain dimensions: `tenantId` + optional `branchId` + optional
  `currencyCode` (document meters); `api_calls` / `storage_bytes` roll up at
  tenant level (`branchId`/`currencyCode` null).

**Rationale**: Matches clarify + user plan; supports SC-006 billing readiness
and SC-004 read performance.

**Alternatives considered**: Live SQL over Documents only (no API/storage
history, expensive filters); stream-only without rollups (slow dashboards);
monthly-only (weak day charts).

---

## R2 — Canonical meters

**Decision**: Persist and expose exactly:
`issued` | `received` | `valid` | `invalid` | `api_calls` | `storage_bytes`.

| Meter | Emission trigger (product rules) |
|-------|----------------------------------|
| `issued` | Outbound document enters counted issued/submitted-accepted state (align Documents) |
| `received` | Received/purchase document recorded for tenant |
| `valid` / `invalid` | Authoritative validation outcome event (authority/product final classification) |
| `api_calls` | Authenticated API request in tenant context (middleware/interceptor; exclude health/unauthenticated) |
| `storage_bytes` | Absolute retained-bytes snapshot when artifacts change or on scheduled refresh |

**Rationale**: Spec FR-001 + clarify identifiers.

**Alternatives considered**: Separate “submitted” vs “issued” meters (out of
scope); ETA upstream call billing (rejected by assumptions).

---

## R3 — `storage_bytes` as absolute gauge

**Decision**: Each storage-related `UsageEvent` stores **absolute**
`quantity = current total bytes` for the tenant (gauge). Daily/monthly rollup
value for `storage_bytes` = **latest event quantity in the bucket** (end-of-day
/ end-of-month snapshot). Deletes/expiry emit a new lower absolute value.

**Rationale**: Unanswered clarify Q4; recommended Option A — matches “how much
storage we use,” avoids delta drift. Documented as planning default; can
revisit in `/speckit-clarify` if product prefers deltas.

**Alternatives considered**: Delta-only (+/−); hybrid snapshot+delta (more
complex for MVP).

---

## R4 — Counter meters & idempotency

**Decision**:
- For `issued`, `received`, `valid`, `invalid`, `api_calls`: events carry
  `quantity` (usually `1`) and an **`idempotencyKey`** unique per
  `(tenantId, meter, idempotencyKey)` so retries do not double-count.
- Document meters use keys like `issued:{documentId}`,
  `valid:{documentId}:{outcomeVersion}` (outcome changes emit correcting
  events or superseding keys per implementation note in data-model — prefer
  **one current outcome** reflected in rollup rebuild rules).
- Rollup for counters = **sum(quantity)** of events in the bucket (after
  idempotent insert).

**Rationale**: Exact-match dashboard tests; prevents double submit/API retry
inflation.

**Alternatives considered**: No idempotency (flaky totals); store only
document FKs without event log (harder API/storage).

---

## R5 — Analytics API + export service

**Decision**:
- Nest module `analytics`:
  - `GET /analytics/summary` — totals for filters
  - `GET /analytics/series` — time series (daily or monthly grain)
  - `POST /analytics/exports` + `GET .../download` — **CSV and XLSX**
- Filters: `from`, `to`, `branchId?`, `currencyCode?`, `grain=day|month`.
- Large exports: async job → MinIO artifact (reuse 009 pattern); small sync
  download allowed under size threshold.
- Reuse CSV/XLSX writing approach from exports (SheetJS/xlsx).

**Rationale**: User plan + FR-012/013; consistent with bulk export UX.

**Alternatives considered**: Sync-only export (timeouts); PDF reports (out of
scope).

---

## R6 — Web dashboard (recharts)

**Decision**:
- Route `/[locale]/(app)/analytics` with filter bar (branch, period presets +
  custom range, currency) and **recharts** line/bar charts + metric cards.
- TanStack Query against analytics endpoints; next-intl `analytics.*` keys;
  RTL-safe layout.
- Export control: choose CSV or XLSX.

**Rationale**: User plan specifies recharts; design system + i18n constitution.

**Alternatives considered**: Chart.js, Visx, server-rendered images (worse
interactivity).

---

## R7 — Permissions

**Decision**: Add `analytics.view` and `analytics.export`. Seed **Owner** and
**Admin** only by default (Accountant/Viewer lack until granted). Do **not**
reuse `billing.view` (Accountants already have billing).

**Rationale**: Spec FR-016; existing `billing.*` codes reserved for future
charging.

**Alternatives considered**: Reuse `billing.view` (wrong role matrix);
`documents.view` only (too broad / too narrow for API/storage meters).

---

## R8 — Exact-match acceptance test

**Decision**: Integration test (and quickstart scenario): create a **known**
mix of issued/received documents with valid/invalid outcomes under one tenant;
run rollup (or await job); `GET /analytics/summary` (and UI) totals for
`issued`/`received`/`valid`/`invalid` **equal exact expected integers**. Second
tenant with different activity must not affect first.

**Rationale**: User plan + SC-002.

**Alternatives considered**: Snapshot-fuzzy assertions (rejected — must be
exact).

---

## R9 — Timezone & period buckets

**Decision**: Bucket events into calendar day/month using product default
timezone **`Africa/Cairo`** unless an existing tenant timezone setting is
already available (then use that). Document in API (`timezone` echo on
summary). No per-user timezone in v1.

**Rationale**: Spec assumptions; Egyptian market default.

**Alternatives considered**: UTC-only buckets (confusing month boundaries for
local ops); per-user TZ (scope creep).

---

## R10 — Agent / ETA serialization

**Decision**: No desktop agent or canonical serialization changes.

**Rationale**: Constitution IV/VIII — out of scope for metering.
