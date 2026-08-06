# Research: Offline Sync (Agent + Web Drafts)

**Feature**: `010-offline-sync` | **Date**: 2026-08-01

Resolves Technical Context choices from the clarified spec and user plan:
PWA + IndexedDB web queue, agent SQLite reuse, idempotent API keys, Conflict UI,
and mandatory offline→reconnect tests.

---

## R1 — Web offline store (PWA + IndexedDB)

**Decision**:
- Ship **PWA** support (web app manifest + service worker) so the app can load
  shell/assets offline after an online visit.
- Persist the **draft offline queue** in **IndexedDB** (typed wrapper such as
  `idb`), keyed by `tenantId` + `clientDocumentId` / idempotency key.
- **Install-to-home-screen is optional**; offline drafts work in a normal
  browser tab once SW + IndexedDB are available (clarify 2026-08-01).

**Rationale**: Matches clarify session; IndexedDB is the durable browser store
suitable for draft JSON; PWA enables offline shell without forcing install on
shared PCs.

**Alternatives considered**: localStorage (size + sync races); OPFS-only (less
ergonomic for structured queue); require install (rejected by clarify).

---

## R2 — Web sync engine + backoff

**Decision**:
- Client **sync engine** drains IndexedDB pending items when `navigator.onLine`
  and API health succeed.
- Transient failures: exponential backoff
  (`SYNC_BACKOFF_INITIAL_MS` → `SYNC_BACKOFF_MAX_MS`, jitter).
- Per-item states: `pending` → `syncing` → `synced` | `conflict` | `failed`.
- In-flight edit while syncing: bump local revision; re-queue after ack so newer
  edit is not dropped (spec edge case).

**Rationale**: SC-006 / FR-004; avoids thundering herd on flaky links.

**Alternatives considered**: Immediate infinite retry (CPU/battery thrash);
server-push-only sync (still need client drain after offline creates).

---

## R3 — Agent SQLite queue resume

**Decision**:
- **Reuse** `Einvoice.Agent.Queue.SqliteOfflineQueue` (`PENDING_SIGN` →
  `PENDING_UPLOAD` → `DONE` | `DEAD`).
- On reconnect, `SigningWorker` already iterates `PENDING_UPLOAD`; harden
  **resume** (no drop on transient network; backoff on upload failures; keep
  signed JSON until ack).
- Send **Idempotency-Key** (and/or document-scoped key) on signature intake and
  submit handoff so retries are safe.

**Rationale**: Spec FR-002 / clarify “reuse SQLite”; code already queues offline
sign/upload — plan extends reliability + idempotent headers, not a new DB.

**Alternatives considered**: Parallel agent store (duplicate states); cloud-only
retry without local durability (data loss when offline).

---

## R4 — Backend idempotency (drafts + submission)

**Decision**:
- **Draft sync**: `PUT/POST` document upsert accepts client header/body
  `Idempotency-Key` (or `clientIdempotencyKey`) **per document**. Same key +
  tenant → return existing document (no duplicate row).
- **Submission**: extend/confirm existing submissions path
  (`Idempotency-Key` / `batchIdempotencyKey`) so agent/web resync of the same
  signed document version yields **one** submission.
- Persist key on document (and/or submission) with unique
  `(tenantId, clientIdempotencyKey)` where applicable.
- Detect **clashes** when server revision ≠ client base revision and overlapping
  fields/lifecycle changed → return `409 conflict` payload for Conflict UI.

**Rationale**: Spec FR-008/FR-009; user plan “idempotent submission endpoint
keyed by client idempotency key”; submissions module already has key plumbing.

**Alternatives considered**: Server-only UUIDs without client key (duplicates on
retry); blind overwrite (violates Conflict UI).

---

## R5 — Conflict UI

**Decision**:
- Dedicated web **Conflict UI** (route or modal from sync panel): show local vs
  server summary; actions **keep local**, **keep server**, **field merge**
  (draft content); lifecycle clashes may force binary choice.
- Agent surfaces `conflict`/`failed` status; resolution of draft clashes is
  **web-primary** (agent focuses on sign/upload idempotency).

**Rationale**: Spec FR-007 / clarify Conflict UI; accountants resolve content on
web.

**Alternatives considered**: Toast-only (rejected); agent WinForms merge editor
(out of scope for v1).

---

## R6 — Security & tenant isolation for IndexedDB

**Decision**:
- Partition IndexedDB by `tenantId` (+ user id); wipe or quarantine queue on
  org switch / logout after warning if unsynced.
- Never store ETA client secrets, refresh tokens beyond existing session
  patterns, or signing PINs in IndexedDB.
- All sync calls use existing JWT + `X-Tenant-Id` + TLS.

**Rationale**: Constitution II/III; FR-012/FR-014.

**Alternatives considered**: Single global store (cross-tenant leak risk).

---

## R7 — Test strategy (mandatory gates)

**Decision**:
1. **Offline create → reconnect → single document** (web IndexedDB → API
   idempotent upsert).
2. **Offline sign → reconnect → single submission** (agent SQLite
   `PENDING_UPLOAD` → intake + submit; replay N times → one effect).
3. **Conflict scenario**: divergent local/server draft → `409` → Conflict UI
   resolution → one converged document.
4. **Regression**: 005 golden vectors, agent CAdES, `cades-digest`, submission
   payload integrity remain green.

**Rationale**: User plan + SC-001/SC-002/SC-003; constitution I/IV.

**Alternatives considered**: Manual-only QA (insufficient for regulated path).

---

## R8 — Out of scope (explicit)

- Offline settings / users / bulk import jobs
- Native mobile apps
- Calling ETA while disconnected
- Requiring PWA install before offline drafts

---

## Open items deferred to `/speckit-tasks`

- Exact SW registration strategy (`next-pwa` vs custom worker in App Router)
- Whether conflict field-merge supports nested line-item merge in v1 or
  document-level only
- Env defaults for backoff timings
