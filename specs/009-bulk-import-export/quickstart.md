# Quickstart: Bulk Import / Export

**Feature**: `009-bulk-import-export`  
**Purpose**: Validate Import Wizard (valid rows only), error report, optional
sign/submit handoff, local export, and ETA package round-trip after
implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, MinIO, API, web)
- Tenant with **sandbox/preprod** ETA credentials (for package tests)
- User with `documents.manage` (Owner / Admin / Accountant)
- Paired desktop signing agent online (only for Create, sign & submit path)
- Optional: `ETA_SANDBOX_INTEGRATION=1` for automated package round-trip
- Contracts: [imports-exports-api.yaml](./contracts/imports-exports-api.yaml),
  [eta-document-packages.md](./contracts/eta-document-packages.md)

## 1. Template + mixed-row import (required)

1. Open `/en/imports` (and `/ar/imports` for RTL smoke).
2. Download **CSV** (and optionally **XLSX**) template for invoice type `I`.
3. Build a fixture with **dozens of rows** including several **invalid** rows
   (missing required field, bad tax code, duplicate internal id).
4. Wizard: upload → confirm mapping → **Validate**.
5. Expect: valid/invalid counts; error report downloadable; invalid rows listed.
6. **Run** with `CREATE_ONLY`.
7. Expect: only valid rows become documents; invalid rows have no `documentId`;
   job status `PARTIAL` or `SUCCEEDED` with `invalidRows > 0` still allowing
   creates.

API sketch:

```http
POST /imports/jobs
Authorization: Bearer <token>
X-Tenant-Id: <tenantUuid>
Content-Type: multipart/form-data
```

```http
PUT /imports/jobs/{jobId}/mapping
POST /imports/jobs/{jobId}/validate
POST /imports/jobs/{jobId}/run
{ "runMode": "CREATE_ONLY" }
```

```bash
pnpm --filter api test -- import
```

Expect unit/integration: **0** documents for invalid rows; **N** documents for
**N** valid rows.

## 2. Create, sign & submit (optional agent)

1. Same fixture (or all-valid subset); run with `CREATE_SIGN_SUBMIT`.
2. Expect sign jobs only for created (valid) documents.
3. With agent online, documents leave draft and enter submission pipeline
   (existing 007 behavior).

## 3. Local export

1. Open `/en/exports`.
2. Create local export: filters for imported docs; formats CSV + JSON
   (optionally XLSX).
3. Wait until `READY`; download each format.
4. Expect only tenant documents matching filters; no other tenant data.

```http
POST /exports/local
{ "formats": ["CSV", "JSON"], "filters": { "from": "...", "to": "..." } }
GET /exports/jobs/{jobId}/download?format=csv
```

## 4. ETA package round-trip (sandbox gated)

```bash
ETA_SANDBOX_INTEGRATION=1 pnpm --filter api test -- package
```

Or manual:

1. Export Center → **Request ETA package** for a date window with known filed
   docs.
2. Job shows `IN_PROGRESS` while **Get Package Requests** is polled.
3. When ready → download zip; object present under tenant MinIO prefix
   `tenants/{tenantId}/artifacts/packages/`.

Expect: product status follows Get Package Requests; zip downloadable; audit
entry present; cross-tenant download denied.

## 5. Package-ready accelerate (optional)

```http
POST /webhooks/eta/package-ready
Authorization: Bearer <token>
X-Tenant-Id: <tenantUuid>
Content-Type: application/json

{ "etaRequestId": "<rid>" }
```

Expect: enqueues an immediate `package-poll` job; worker still calls
**Get Package Requests** before any zip download.

## 6. Regression

- 005 golden / serialization parity still green
- 007 submit gates still green (import must not mutate signed bytes)

## 7. Commands + routes

```bash
pnpm --filter @einvoice/api test -- --testPathPattern="import|export|eta-package"
pnpm --filter @einvoice/web test -- --testPathPattern="imports.smoke|exports"
pnpm --filter @einvoice/api prisma:generate
pnpm --filter @einvoice/api prisma:migrate
```

| UI | Path |
|----|------|
| Import Wizard | `/en/imports`, `/ar/imports` |
| Export Center | `/en/exports`, `/ar/exports` |

## Out of scope checks (must not appear)

- `.xls` accepted as upload
- All-or-nothing import that refuses valid rows because bad rows exist
- Watched-folder / cron file pickup
- Package status driven only by webhook without Get Package Requests
