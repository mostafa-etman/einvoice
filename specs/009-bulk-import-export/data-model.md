# Data Model: Bulk Import / Export

**Feature**: `009-bulk-import-export` | **Date**: 2026-07-31

All new tables are **tenant-scoped** with **FORCE RLS**. Issued `Document`
lifecycle unchanged except optional lineage fields / join to import jobs.

---

## Enums

### `ImportJobStatus`

`UPLOADED` | `MAPPING` | `VALIDATING` | `VALIDATED` | `RUNNING` | `SUCCEEDED` | `PARTIAL` | `FAILED`

- `PARTIAL`: run finished with ≥1 created and ≥1 invalid/failed row (or sign
  blocked for some).
- `SUCCEEDED`: all processed valid rows created (and sign/submit handoff OK when
  requested), zero unexpected failures.

### `ImportRowStatus`

`VALID` | `INVALID` | `CREATED` | `SIGN_ENQUEUED` | `FAILED`

### `ExportJobKind`

`LOCAL` | `ETA_PACKAGE`

### `ExportJobStatus`

`QUEUED` | `RUNNING` | `READY` | `FAILED` | `EXPIRED`

### `EtaPackageStatus` (local mirror)

`REQUESTED` | `IN_PROGRESS` | `READY` | `ERROR` | `DELETED` | `STALLED`

Maps from ETA Get Package Requests numeric status (1 in progress, 2 complete,
3 error, 4 deleted) plus local `STALLED` after poll cutoff.

### `ImportRunMode`

`CREATE_ONLY` | `CREATE_SIGN_SUBMIT`

### `ExportFormat`

`CSV` | `XLSX` | `PDF` | `JSON`

---

## Entities

### `ImportJob`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `createdByUserId` | uuid | Actor |
| `documentType` | text | Single issued type per job (e.g. `I`) |
| `documentTypeVersion` | text? | When applicable |
| `branchId` | uuid? | Default branch if not per-row |
| `status` | `ImportJobStatus` | |
| `runMode` | `ImportRunMode`? | Set at run; null until run |
| `sourceFileName` | text | |
| `sourceContentType` | text | `text/csv` or XLSX MIME |
| `sourceByteSize` | int | |
| `sourceChecksum` | text | sha256 |
| `sourceObjectKey` | text | MinIO key |
| `mappingJson` | jsonb? | Column mapping snapshot |
| `totalRows` | int | |
| `validRows` | int | |
| `invalidRows` | int | |
| `createdDocs` | int | |
| `signEnqueued` | int | |
| `failedRows` | int | |
| `errorReportObjectKey` | text? | MinIO |
| `errorSummary` | text? | File-level message |
| `startedAt` / `finishedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

**Indexes**: `(tenantId, createdAt DESC)`, `(tenantId, status)`

### `ImportRowResult`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | |
| `importJobId` | uuid | Cascade delete |
| `rowNumber` | int | 1-based data row |
| `businessKey` | text? | Mapped internal id / external key |
| `status` | `ImportRowStatus` | |
| `errorsJson` | jsonb | `[{ field, code, message }]` |
| `documentId` | uuid? | When created |
| `rawRowJson` | jsonb? | Optional redacted snapshot for debug |

**Constraints**: `@@unique([importJobId, rowNumber])`  
**Indexes**: `(tenantId, importJobId, status)`

### `Document` (existing — additive)

| Field / relation | Notes |
|------------------|-------|
| `importJobId` | uuid? FK → `ImportJob` (nullable) |
| `importRowNumber` | int? |

Or join-only via `ImportRowResult.documentId` if schema prefers no Document
columns — **prefer FK on Document** for list “imported from” filter (FR-021).

### `ExportJob`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | |
| `createdByUserId` | uuid | |
| `kind` | `ExportJobKind` | LOCAL vs ETA_PACKAGE |
| `status` | `ExportJobStatus` | |
| `filtersJson` | jsonb | dateFrom/to, types, statuses, branchId, … |
| `formatsJson` | jsonb | `ExportFormat[]` (LOCAL only; empty for ETA) |
| `artifactObjectKeysJson` | jsonb? | `{ csv?, xlsx?, pdfZip?, json? }` |
| `expiresAt` | timestamptz? | |
| `errorSummary` | text? | |
| `etaPackageRequestId` | uuid? | FK when kind = ETA_PACKAGE |
| `startedAt` / `finishedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

**Indexes**: `(tenantId, createdAt DESC)`, `(tenantId, kind, status)`

### `EtaPackageRequest`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | |
| `exportJobId` | uuid | 1:1 with ExportJob of kind ETA_PACKAGE |
| `etaRequestId` | text | Authority package/request id (`rid`) |
| `localStatus` | `EtaPackageStatus` | |
| `etaStatusRaw` | int? | Last Get Package Requests status code |
| `requestPayloadJson` | jsonb | Filters sent to ETA |
| `packageObjectKey` | text? | MinIO zip when downloaded |
| `packageByteSize` | int? | |
| `lastPolledAt` | timestamptz? | |
| `readyAt` | timestamptz? | |
| `errorSummary` | text? | |
| `notificationAcceleratedAt` | timestamptz? | When webhook triggered poll |
| `createdAt` / `updatedAt` | timestamptz | |

**Constraints**: `@@unique([tenantId, etaRequestId])`  
**Indexes**: `(tenantId, localStatus)`, `(tenantId, exportJobId)`

---

## Relationships

```text
ImportJob 1──* ImportRowResult
ImportJob 1──* Document (optional FK)
ExportJob 1──0..1 EtaPackageRequest
ExportJob *── artifacts in MinIO (keys on job)
```

---

## State transitions

### ImportJob

```text
UPLOADED → MAPPING → VALIDATING → VALIDATED → RUNNING → SUCCEEDED | PARTIAL | FAILED
                         ↘ FAILED (file-level)
```

### EtaPackageRequest

```text
REQUESTED → IN_PROGRESS → READY → (ExportJob READY + artifact)
                      ↘ ERROR | DELETED | STALLED
```

Poll loop only advances on **Get Package Requests** (and confirmed Get Document
Package 200). Webhook may set `notificationAcceleratedAt` and enqueue immediate
poll.

---

## Validation rules (summary)

- One `documentType` per `ImportJob`.
- `mappingJson` must cover all required template fields before VALIDATING.
- `ImportRowResult` INVALID rows never receive `documentId`.
- `IMPORT_MAX_ROWS` / `IMPORT_MAX_BYTES` enforced at upload/validate.
- `ExportJob` LOCAL requires ≥1 format; ETA_PACKAGE creates linked
  `EtaPackageRequest`.
- Artifact download denied cross-tenant (RLS + key prefix check).

---

## RLS

- ENABLE + FORCE RLS on all new tables; policy `tenant_id = current_setting('app.tenant_id')::uuid` (same as documents).
- Workers: `SET LOCAL` tenant context per job before Prisma access.
