# Quickstart: Usage Analytics & Metering

**Feature**: `011-usage-analytics`  
**Purpose**: Validate event→rollup metering, exact dashboard totals, filters,
and CSV/XLSX export after implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, MinIO, API, web)
- Tenant A and Tenant B with Owner/Admin users
- Contracts: [analytics-api.yaml](./contracts/analytics-api.yaml),
  [permissions.md](./contracts/permissions.md)
- Permissions `analytics.view` + `analytics.export` on test Owner/Admin

## 1. Exact-match totals (required)

Create a **known** fixture under Tenant A (same branch/currency unless testing
filters):

| Meter | Count |
|-------|------:|
| `issued` | N₁ |
| `received` | N₂ |
| `valid` | N₃ |
| `invalid` | N₄ |

1. Perform the operational actions that emit those meters (submit/accept
   outbound docs, record received docs, set valid/invalid outcomes).
2. Trigger or await **daily rollup** job for Tenant A.
3. Call summary for the period covering the fixture:

```http
GET /analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <tokenA>
X-Tenant-Id: <tenantA>
```

4. Expect: `totals.issued === N₁`, `received === N₂`, `valid === N₃`,
   `invalid === N₄` (**exact integers**).
5. Open `/en/analytics` (and `/ar/analytics` for RTL) with the same filters —
   UI cards match API totals.

```bash
pnpm --filter api test -- analytics
```

Expect integration test name covering exact match + Tenant B isolation.

## 2. Tenant isolation

1. Create different activity under Tenant B.
2. As Tenant A, confirm summary unchanged and contains no Tenant B magnitudes.
3. As user without `analytics.view`, expect `403` and no UI data.

## 3. Filters

1. Split fixture across two branches and/or two currencies.
2. `GET /analytics/summary?branchId=...` → document meters match that branch
   only.
3. `currencyCode=EGP` → document meters for EGP only.
4. Confirm response `notes` (or UI labels) state that `api_calls` /
   `storage_bytes` remain organization-level when branch/currency set.

## 4. Series

```http
GET /analytics/series?from=...&to=...&grain=day
```

Expect daily points whose sums equal summary totals for counter meters over the
same range.

## 5. Export CSV + XLSX

```http
POST /analytics/exports
Authorization: Bearer <tokenA>
X-Tenant-Id: <tenantA>
Content-Type: application/json

{ "format": "CSV", "from": "...", "to": "...", "grain": "day" }
```

1. Wait until `READY`; download; open file — meter columns present; totals match
   dashboard for same filters.
2. Repeat with `"format": "XLSX"`.
3. User without `analytics.export` → `403`.
4. Audit log shows export actor, tenant, filters, outcome.

## 6. api_calls + storage_bytes smoke

1. Generate a few authenticated API calls under Tenant A; rollup; expect
   `api_calls` ≥ that count (exact if test isolates traffic).
2. Store a known artifact size; emit/refresh storage snapshot; expect
   `storage_bytes` equals absolute retained bytes for tenant (gauge).

## Done when

- [ ] Exact-match issued/received/valid/invalid test green
- [ ] Cross-tenant isolation proven
- [ ] CSV and XLSX exports match dashboard filters
- [ ] Analytics UI works in en + ar (RTL)
- [ ] No desktop agent or serialization changes required
