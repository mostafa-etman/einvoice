# Data Model: Offline Sync

**Feature**: `010-offline-sync` | **Date**: 2026-08-01

## Overview

Three stores cooperate: **PostgreSQL** (organization source of truth +
idempotency), **web IndexedDB** (draft queue), **agent SQLite** (existing
sign/upload queue). Sync converges clients to Postgres without duplicate
documents or submissions.

---

## PostgreSQL (tenant-scoped, FORCE RLS)

### Document (extend existing)

| Field | Notes |
|-------|--------|
| `id` | Server UUID (unchanged) |
| `tenantId` | RLS |
| `clientIdempotencyKey` | **New** nullable unique per tenant; set on first offline/online create from client key |
| `syncRevision` | **New** monotonic int (or reuse `version` if sufficient) for conflict base |
| `updatedAt` / `version` | Existing optimistic concurrency |

**Rules**:
- Unique `(tenantId, clientIdempotencyKey)` where key is not null.
- Idempotent create: same key returns existing row (200/201 with same id).
- Clash: client sends `baseRevision`; if server revision advanced with
  overlapping changes → conflict, no silent overwrite.

### Submission (existing)

| Field | Notes |
|-------|--------|
| `batchIdempotencyKey` | Existing; agent/web MUST pass stable per-document (or batch) key on resync |
| `tenantId` | RLS |

**Rules**: Replay of same key returns prior submission outcome; no second ETA
POST for same signed document version.

### SyncConflict (optional table **or** ephemeral 409 body)

If persisted for audit/UI resume:

| Field | Notes |
|-------|--------|
| `id` | UUID |
| `tenantId` | RLS |
| `documentId` | FK |
| `clientIdempotencyKey` | |
| `localSnapshotJson` | Client payload at clash |
| `serverSnapshotJson` | Server payload at clash |
| `status` | `OPEN` \| `RESOLVED` |
| `resolution` | `KEEP_LOCAL` \| `KEEP_SERVER` \| `MERGED` |
| `resolvedByUserId` | |
| `createdAt` / `resolvedAt` | |

---

## Web IndexedDB

**Database**: `einvoice-offline` (name illustrative)

**Object store**: `draftQueue`

| Property | Type | Notes |
|----------|------|--------|
| `idempotencyKey` | string | **Primary key**; per document |
| `tenantId` | string | Partition |
| `userId` | string | Actor |
| `serverDocumentId` | string? | Set after first ack |
| `baseRevision` | number | Last known server revision |
| `localRevision` | number | Increments on each local edit |
| `payload` | object | Draft DTO |
| `status` | enum | `pending` \| `syncing` \| `synced` \| `conflict` \| `failed` |
| `lastError` | string? | |
| `updatedAt` | string | ISO |

**Indexes**: `tenantId+status`, `updatedAt`

**Rules**: Never store ETA secrets/PINs; wipe/quarantine on tenant switch after
warning if unsynced remain.

---

## Agent SQLite (existing)

Table `LocalQueueItem` (already present):

| Column | Notes |
|--------|--------|
| `JobId` | UNIQUE |
| `DocumentId` | |
| `DocumentVersion` | |
| `PayloadJson` | Unsigned claim payload |
| `SignedJson` | After sign |
| `State` | `PENDING_SIGN` → `PENDING_UPLOAD` → `DONE` \| `DEAD` |
| `Attempts` / `LastError` / `UpdatedAt` | |

**Extensions (minimal)**:
- Ensure upload/submit HTTP includes **Idempotency-Key** derived from
  `DocumentId` + `DocumentVersion` (stable across retries).
- Resume loop MUST continue `PENDING_UPLOAD` after reconnect with backoff.

---

## State transitions

### Draft queue item (web)

```text
(create/edit offline) → pending
pending → syncing → synced
syncing → failed → pending (retry)
syncing → conflict → (Conflict UI) → syncing → synced
```

### Agent queue item

```text
PENDING_SIGN → PENDING_UPLOAD → DONE
any retryable fail → same state + Attempts++
non-retryable / cancelled → DEAD
```

### Conflict record

```text
OPEN → RESOLVED (KEEP_LOCAL | KEEP_SERVER | MERGED)
```

---

## Validation rules

- Idempotency key: non-empty, ≥8 chars, stable for document lifetime on client.
- Clash detection: overlapping field paths or incompatible status vs
  `baseRevision`.
- Sync MUST NOT mutate signed bytes on agent upload path.
- Cross-tenant queue access forbidden.
