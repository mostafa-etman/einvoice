# Data Model: Purchases (Received Documents)

**Feature**: `008-purchases-received` | **Date**: 2026-07-31

All new tables are **tenant-scoped** with **FORCE RLS** (same pattern as
`documents` / `item_code_sync_runs`). Issued `Document` is unchanged.

---

## Enums

### `ReceivedDocumentKind`

| Value | Meaning |
|-------|---------|
| `PURCHASE_INVOICE` | ETA type Invoice (`I`) |
| `PURCHASE_RETURN` | ETA type Credit Note (`C`) |
| `OTHER_RECEIVED` | Any other received type |

### `ReceivedBuyerDecision`

| Value | Meaning |
|-------|---------|
| `NONE` | No buyer decision yet |
| `ACCEPTED` | Local accept (and optional decline-cancelation success) |
| `REJECTED` | Buyer rejected at ETA |
| `DECLINED_CANCELATION` | Receiver declined issuer cancellation |
| `NEEDS_ATTENTION` | ETA call failed or document not actionable |

### `ReceivedReconciliationStatus`

| Value | Meaning |
|-------|---------|
| `PENDING_REVIEW` | Default after sync |
| `RECONCILED` | Manually marked reconciled |
| `DISPUTED` | Manually disputed |

### `ReceivedSyncTrigger`

| Value | Meaning |
|-------|---------|
| `CRON` | Scheduled |
| `MANUAL` | Sync now |

### `ReceivedSyncRunStatus`

`PENDING` | `RUNNING` | `SUCCEEDED` | `FAILED`

---

## Entities

### `ReceivedDocument`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | RLS |
| `documentUuid` | text | **Required**; unique with tenant |
| `etaLongId` | text? | When present |
| `internalId` | text? | Issuer internal id |
| `etaDocumentType` | text | Raw ETA type code (`I`, `C`, …) |
| `etaDocumentTypeVersion` | text? | |
| `kind` | `ReceivedDocumentKind` | Classification |
| `etaStatus` | text? | Raw authority status string |
| `dateTimeIssued` | timestamptz? | |
| `issuerType` / `issuerId` / `issuerName` | text? | Snapshot |
| `issuerJson` | jsonb? | Full issuer object |
| `receiverJson` | jsonb? | As returned by ETA |
| `currency` | text? | |
| `totalAmount` / `netAmount` / … | decimal strings | Summary for list |
| `rawSummaryJson` | jsonb | List/search row snapshot |
| `rawDetailsJson` | jsonb? | Full details when fetched |
| `buyerDecision` | `ReceivedBuyerDecision` | Default `NONE` |
| `buyerDecisionReason` | text? | Required when rejected |
| `buyerDecisionAt` | timestamptz? | |
| `buyerDecisionByUserId` | uuid? | |
| `reconciliationStatus` | `ReceivedReconciliationStatus` | Default `PENDING_REVIEW` |
| `reconciliationNote` | text? | |
| `purchaseOrderLinkId` | uuid? | **Hook only** — no PO table FK in this release |
| `reconciliationExternalRef` | text? | Future matcher hook |
| `branchId` | uuid? | Optional assignment → `branches` |
| `needsAttention` | bool | |
| `needsAttentionReason` | text? | |
| `lastSyncedAt` | timestamptz | |
| `printoutArtifactId` | uuid? | Optional FK to artifact |
| `createdAt` / `updatedAt` | timestamptz | |

**Constraints**: `@@unique([tenantId, documentUuid])`  
**Indexes**: `(tenantId, dateTimeIssued)`, `(tenantId, kind)`, `(tenantId, buyerDecision)`, `(tenantId, reconciliationStatus)`, `(tenantId, branchId)`

### `ReceivedDocumentLine`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | |
| `receivedDocumentId` | uuid | Cascade delete |
| `lineNumber` | int? | |
| `description` | text? | |
| `itemCode` / `itemType` / `unitType` | text? | |
| `quantity` / `unitPrice` / `netTotal` / `total` | text? | Money strings |
| `taxesJson` | jsonb | Line taxes array |
| `rawJson` | jsonb? | |

**Indexes**: `(receivedDocumentId)`

### `ReceivedDocumentSyncRun`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `tenantId` | uuid | |
| `trigger` | `ReceivedSyncTrigger` | |
| `status` | `ReceivedSyncRunStatus` | |
| `fetchedCount` / `newCount` / `updatedCount` / `skippedCount` / `failedCount` | int | |
| `errorSummary` | text? | No secrets |
| `startedAt` / `finishedAt` | timestamptz? | |
| `triggeredByUserId` | uuid? | Null for cron |
| `createdAt` | timestamptz | |

### `ReceivedBuyerDecisionEvent` (optional audit mirror)

Prefer **central `audit` log** for accept/reject/reconciliation (constitution).
If a dedicated trail is needed for UI history:

| Field | Notes |
|-------|-------|
| `id`, `tenantId`, `receivedDocumentId` | |
| `action` | `ACCEPT` / `REJECT` / `DECLINE_CANCELATION` / `RECONCILE` |
| `fromDecision` / `toDecision` | |
| `reason` | |
| `actorUserId` | |
| `etaHttpStatus` / `etaBodyJson` | Sanitized |
| `createdAt` | |

MVP may rely on `AuditService` only and skip this table — choose in tasks;
plan allows either.

---

## Relationships

```text
Tenant 1──* ReceivedDocument
Branch 1──* ReceivedDocument (optional)
ReceivedDocument 1──* ReceivedDocumentLine
ReceivedDocument *──? DocumentArtifact (printout; extend artifact with receivedDocumentId)
Tenant 1──* ReceivedDocumentSyncRun
```

### `DocumentArtifact` extension

Add nullable `receivedDocumentId` (uuid FK, on delete set null). Existing
`documentId` remains for issued printouts. Kind e.g. `printout`.

---

## State transitions

### Buyer decision

```text
NONE → ACCEPTED          (Accept; local ± decline cancelation)
NONE → REJECTED          (Reject + reason; ETA success)
NONE → NEEDS_ATTENTION   (ETA failure)
ACCEPTED | REJECTED → (terminal for opposite action; 409)
NEEDS_ATTENTION → ACCEPTED | REJECTED (retry allowed)
+ DECLINED_CANCELATION when decline-cancelation succeeds from eligible ETA state
```

### Reconciliation (independent of buyer decision)

```text
PENDING_REVIEW ↔ RECONCILED ↔ DISPUTED
```

PO link may be set later without changing these statuses.

### Sync run

```text
PENDING → RUNNING → SUCCEEDED | FAILED
```

Only one RUNNING/PENDING per tenant at a time (app-enforced).

---

## Validation rules

- `documentUuid` required and unique per tenant.
- Reject requires non-empty `buyerDecisionReason`.
- `kind` must match classifier output for stored `etaDocumentType` (recompute on
  sync; do not trust client).
- `purchaseOrderLinkId` may be null always in this release; APIs MUST NOT
  require PO matching.
- Branch assignment must reference an active branch of the same tenant.

---

## RLS

- Enable + FORCE RLS on all new tenant tables.
- Policies: `tenant_id = current_setting('app.tenant_id')::uuid` (match
  existing `rls.sql` conventions).
- Sync jobs: `TenantPrismaService.withTenant(tenantId, ...)`.
