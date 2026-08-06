# Data Model: Usage Analytics & Metering

**Feature**: `011-usage-analytics` | **Date**: 2026-08-01

All new tables are **tenant-scoped** with **FORCE RLS**. Existing Document /
ReceivedDocument / artifact tables unchanged except optional emit hooks.

---

## Enums

### `UsageMeter`

`issued` | `received` | `valid` | `invalid` | `api_calls` | `storage_bytes`

### `UsageRollupGrain` (API/query only; tables are separate)

`day` | `month`

### `UsageExportFormat`

`CSV` | `XLSX`

### `UsageExportJobStatus`

`QUEUED` | `RUNNING` | `READY` | `FAILED` | `EXPIRED`

---

## Entities

### `UsageEvent`

Append-only metering observation.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `meter` | `UsageMeter` | Canonical identifier |
| `quantity` | decimal/bigint | Counters: usually `1`; `storage_bytes`: absolute bytes |
| `occurredAt` | timestamptz | Event time (bucket source) |
| `branchId` | uuid? | Document meters when known; null for org-level |
| `currencyCode` | text? | ISO code for document meters; null for org-level |
| `documentId` | uuid? | When tied to outbound document |
| `receivedDocumentId` | uuid? | When tied to purchase/received |
| `idempotencyKey` | text | Unique with tenant+meter |
| `metaJson` | jsonb? | Non-secret context (route class, artifact kind) |
| `createdAt` | timestamptz | Insert time |

**Constraints**: `@@unique([tenantId, meter, idempotencyKey])`  
**Indexes**: `(tenantId, occurredAt)`, `(tenantId, meter, occurredAt)`,
`(tenantId, branchId, occurredAt)`

**Rules**:
- Counter meters: quantity ≥ 0; rollup = sum in bucket.
- `storage_bytes`: quantity = absolute total bytes ≥ 0; rollup = latest
  `occurredAt` quantity in bucket (gauge).
- Never store secrets in `metaJson`.

---

### `UsageDailyRollup`

Materialized day bucket.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `bucketDate` | date | Calendar date in metering timezone |
| `meter` | `UsageMeter` | |
| `branchId` | uuid? | Part of grain; null = tenant-level / all-branches row policy per research |
| `currencyCode` | text? | Part of grain for document meters |
| `value` | decimal/bigint | Sum (counters) or end-of-day absolute (`storage_bytes`) |
| `eventCount` | int | Events contributing (debug/rebuild) |
| `asOf` | timestamptz | Rollup compute time |
| `createdAt` / `updatedAt` | timestamptz | |

**Constraints**:  
`@@unique([tenantId, bucketDate, meter, branchId, currencyCode])`  
(use sentinel empty string or partial unique strategy for nulls per Prisma/PG
conventions — document in migration)

**Indexes**: `(tenantId, bucketDate)`, `(tenantId, meter, bucketDate)`

---

### `UsageMonthlyRollup`

Materialized month bucket (derived from daily preferred).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `bucketMonth` | date | First day of month in metering timezone |
| `meter` | `UsageMeter` | |
| `branchId` | uuid? | |
| `currencyCode` | text? | |
| `value` | decimal/bigint | Sum of daily counters; `storage_bytes` = last daily value in month |
| `asOf` | timestamptz | |
| `createdAt` / `updatedAt` | timestamptz | |

**Constraints**:  
`@@unique([tenantId, bucketMonth, meter, branchId, currencyCode])`

---

### `UsageExportJob` (optional but recommended)

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `createdByUserId` | uuid | |
| `status` | `UsageExportJobStatus` | |
| `format` | `UsageExportFormat` | CSV \| XLSX |
| `filtersJson` | jsonb | from/to, branchId, currencyCode, grain |
| `objectKey` | text? | MinIO key when READY |
| `byteSize` | int? | |
| `errorSummary` | text? | |
| `expiresAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

**Indexes**: `(tenantId, createdAt DESC)`

---

## Relationships

```text
Tenant 1──* UsageEvent
Tenant 1──* UsageDailyRollup
Tenant 1──* UsageMonthlyRollup
Tenant 1──* UsageExportJob
Branch 1──* UsageEvent (optional)
Document 1──* UsageEvent (optional)
ReceivedDocument 1──* UsageEvent (optional)
```

---

## Rollup algorithm (normative)

1. Select events for tenant in `[bucketStart, bucketEnd)` in metering TZ.
2. Group by `(meter, branchId, currencyCode)` (nulls = org-level dimension).
3. Counters: `value = sum(quantity)`.
4. `storage_bytes`: `value = quantity of max(occurredAt)` event in group.
5. Upsert daily row; then rebuild monthly from dailies for affected months.
6. Jobs are idempotent: re-run overwrites rollup values for the bucket.

---

## Validation rules

- `meter` MUST be one of the six enum values.
- `idempotencyKey` REQUIRED on insert; duplicate → no-op / return existing.
- Document-scoped filters ignore org-level-only meters’ fake splits (API returns
  tenant totals labeled org-level).
- Cross-tenant reads impossible under RLS + app `tenantId` context.

---

## State transitions

### UsageExportJob

`QUEUED` → `RUNNING` → `READY` | `FAILED`  
`READY` → `EXPIRED` (retention job)

### UsageEvent / Rollups

Events immutable (append-only). Rollups upserted; no user-editable state.
