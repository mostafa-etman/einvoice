# Data Model: Document Building & Serialization

**Feature**: `005-document-building-serialization` | **Date**: 2026-07-25

## Overview

Persist tenant-scoped commercial **documents** (drafts and ready-for-submit) with
lines and taxes. Monetary fields stored as **strings** (decimal text). Bind each
document to an ETA document type + version id from the 004 catalog cache.
FORCE RLS on all tenant tables. Canonicalization and totals computation remain
in `@einvoice/eta-core` (not duplicated as derived DB columns beyond stored
recomputed totals for display/audit).

## Enums

### DocumentKind

`INVOICE` | `CREDIT_NOTE` | `DEBIT_NOTE` | `EXPORT_INVOICE` |
`EXPORT_CREDIT_NOTE` | `EXPORT_DEBIT_NOTE`

### DocumentStatus

`DRAFT` | `READY`  

(`READY` = passed local validation; **not** submitted to ETA.)

## Entities

### Document

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| kind | DocumentKind | |
| status | DocumentStatus | default `DRAFT` |
| branchId | uuid FK → Branch | issuing branch (active at save) |
| currencyCode | string | must be tenant-enabled |
| exchangeRate | string? | decimal string; required when currency ≠ local |
| issueDateTime | datetime | drives FX lookup |
| internalId | string | unique per tenant |
| etaDocumentType | string | from 004 catalog (e.g. `I`) |
| etaDocumentTypeVersion | string | e.g. `1.0` / `0.9` |
| typeVersionFetchedAt | datetime | when binding resolved |
| receiverType | string? | as ETA requires |
| receiverId | string? | |
| receiverName | string? | |
| receiverAddressJson | jsonb? | structured address |
| issuerSnapshotJson | jsonb | branch/tenant issuer fields frozen at last build |
| referencesJson | jsonb? | original document refs for notes |
| extraDiscountAmount | string | decimal string, default `"0.00"` |
| totalSalesAmount | string | recomputed |
| totalDiscountAmount | string | recomputed |
| netAmount | string | recomputed |
| totalAmount | string | recomputed |
| totalItemsDiscountAmount | string | recomputed |
| taxTotalsJson | jsonb | `[{ taxType, amount }]` decimal strings |
| etaPayloadJson | jsonb | last built ETA document object (ordered) |
| canonicalPreview | text? | optional cache of last canonical (debug) |
| version | int | optimistic concurrency |
| createdAt / updatedAt | datetime | |
| createdByUserId | uuid? | |
| updatedByUserId | uuid? | |

**Rules**:
- Unique `(tenantId, internalId)`.
- Notes (`CREDIT_*` / `DEBIT_*`) MUST have `referencesJson` pointing to same-
  tenant original document when marking `READY`.
- On save: server recomputes all amount fields; ignore client totals.
- Transition to `READY` only if `LocalValidator` returns zero errors.

---

### DocumentLine

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| documentId | uuid FK | |
| lineNumber | int | 1-based order |
| description | string | |
| itemType | string | e.g. EGS/GS1/GPC |
| itemCode | string | |
| unitType | string | |
| quantity | string | decimal/int string as mapped |
| unitPrice | string | amount in sold currency (decimal string) |
| currencySold | string? | if FX line |
| amountSold | string? | |
| amountEgp | string? | |
| currencyExchangeRate | string? | |
| discountRate | string? | |
| discountAmount | string | decimal string |
| salesTotal | string | recomputed |
| netTotal | string | recomputed |
| total | string | recomputed |
| valueDifference | string | default `"0.00"` |
| totalTaxableFees | string | |
| itemsDiscount | string | |
| internalCode | string? | |

**Unique**: `(documentId, lineNumber)`.

---

### DocumentLineTax

| Field | Type | Notes |
|-------|------|--------|
| id | uuid PK | |
| tenantId | uuid FK | RLS |
| documentLineId | uuid FK | |
| taxType | string | ETA tax type |
| subType | string | |
| rate | string | as mapped (`"14.00"`, `"0.00"`, `"12"`, …) |
| amount | string | recomputed decimal string |

---

## Logical (non-persisted) structures

### EtaDocumentPayload

Ordered JSON object produced by builders + calculators; stored in
`etaPayloadJson`. This is the input to `canonicalSerialize`.

### TypeVersionSchema

Runtime metadata from 004 cache for the bound `etaDocumentType` +
`etaDocumentTypeVersion` (required paths, allowed codes). Passed into
`LocalValidator` — not a Prisma table.

### ValidationIssue

`{ code, path, severity, messageKey, params? }` — returned by API; not stored
unless product later wants history (out of scope).

## Relationships

```text
Tenant 1—* Document
Branch 1—* Document
Document 1—* DocumentLine 1—* DocumentLineTax
Document *—0..1 Document (original via referencesJson, same tenant)
```

## RLS

FORCE RLS + policies on: `documents`, `document_lines`, `document_line_taxes`
using `current_setting('app.tenant_id')`.

App role `einvoice_app` remains NOBYPASSRLS.

## State transitions

```text
DRAFT --[validate OK]--> READY
READY --[edit]--> DRAFT          (any mutating save resets to DRAFT)
DRAFT --[delete]--> (removed)
```

No transition to “submitted” in this feature.

## Audit actions (examples)

- `documents.draft.create|update|delete`
- `documents.validate.success|failure`
- `documents.mark_ready.success|failure`

Metadata: document id, kind, status, issue codes — never secrets or full
canonical blobs if oversized (optional hash only).

## Permissions (see contracts/permissions.md)

- `documents.view` — list/get drafts, see preview
- `documents.manage` — create/update/delete, validate, mark ready
