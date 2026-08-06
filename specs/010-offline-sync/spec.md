# Feature Specification: Offline Sync (Agent + Web Drafts)

**Feature Branch**: `010-offline-sync`

**Created**: 2026-08-01

**Status**: Clarified

**Input**: User description: "Feature: Offline sync (agent + web drafts).
- Local offline queue for drafts and signed docs; conflict resolution (last-write + explicit merge for clashes); auto-sync with retry/backoff when connectivity returns; clear sync status indicators; guarantee no data loss and no duplicate submissions (idempotency keys)."

## Clarifications

### Session 2026-08-01

- Q: Where do web drafts persist while offline? → A: **Progressive Web App (PWA)
  offline support** with durable browser local storage via **IndexedDB** for the
  draft offline queue.
- Q: Where does the agent persist offline signed/job outcomes? → A: The agent’s
  existing **SQLite** local queue (extend/reuse; do not invent a parallel store).
- Q: How are duplicates prevented on resync? → A: **Idempotency keys per
  document** so retries and reconnects cannot create duplicate organization
  documents or duplicate signature/submission effects for that document.
- Q: How are clashes presented to users? → A: A dedicated **Conflict UI** for
  clashes (explicit keep-local / keep-server / merge), not silent overwrite or
  toast-only notices.
- Q: Must users install the PWA before offline drafts work? → A: **No.** Offline
  drafts work in a normal browser session (PWA/service worker + IndexedDB);
  install-to-home-screen is optional.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and edit drafts while offline (web) (Priority: P1)

An accountant works from a site with unreliable connectivity. They use the web
app as a **Progressive Web App** so drafts can be saved offline. They open the
app while online (so the session and organization context are established), then
lose connectivity. They continue creating and editing invoice drafts. Changes
are stored in the local offline queue (**IndexedDB**) and show a clear
**pending sync** status. When connectivity returns, drafts sync to the
organization automatically with retry and backoff; the user sees each item move
to **synced** (or **failed** with a recoverable reason).

**Why this priority**: Draft continuity is the primary user pain; without local
queue and status, offline work feels unsafe and is abandoned.

**Independent Test**: With network disabled after login, create and edit a
draft, confirm it remains available and marked pending; restore network and
confirm the draft appears on the server without duplicate documents and status
becomes synced.

**Acceptance Scenarios**:

1. **Given** an authorized user has an active web session and then goes offline,
   **When** they create or edit a draft document, **Then** the change is saved
   locally, remains editable offline, and shows a clear sync status of pending
   (or equivalent wording in ar/en).
2. **Given** pending draft changes exist offline, **When** connectivity returns,
   **Then** the system automatically attempts sync with retry and backoff until
   success or a non-retryable failure is reported to the user.
3. **Given** a draft synced successfully, **When** the user refreshes or opens
   the document list online, **Then** they see one corresponding organization
   document (no duplicate) matching the offline content.
4. **Given** sync fails for a specific item after retries, **When** the user
   views status, **Then** they see which item failed, why (user-facing reason),
   and can retry without losing local data.

---

### User Story 2 - Agent queue for signed documents while offline (Priority: P1)

A signing workstation loses internet after documents are signed locally (or
while signature jobs are claimed). Signed payloads and related job outcomes
remain in the agent’s **SQLite** offline queue. When connectivity returns, the
agent syncs results to the organization using **per-document idempotency keys**
so the same signature completion is never applied twice and authority
submission is never duplicated.

**Why this priority**: Signed bytes and submission handoff are regulated and
high-stakes; offline gaps must not cause lost signatures or double submits.

**Independent Test**: Complete a signature while the agent cannot reach the
API; restore connectivity; confirm the organization receives exactly one
completion for that job version and any subsequent submit uses the existing
idempotent submission path (no second authority submission for the same
content).

**Acceptance Scenarios**:

1. **Given** the desktop agent has a completed signature for a claimed job while
   offline from the API, **When** the user inspects agent status, **Then** they
   see the outcome queued for sync (pending) and the signed artifact is retained
   locally until acknowledged.
2. **Given** queued signed outcomes exist, **When** connectivity returns,
   **When** sync runs, **Then** the organization records the completion once
   (idempotency key / job+version identity) even if the agent retries.
3. **Given** a document is already signed and queued for submission offline,
   **When** sync and submission proceed after reconnect, **Then** the
   organization does not create duplicate submissions for the same signed
   document version.
4. **Given** an auditor reviews events after offline signing and later sync,
   **When** they inspect the audit trail, **Then** they see actor/device,
   organization, document/job identity, sync outcome, and timestamps (no
   secrets or raw private key material).

---

### User Story 3 - Conflict resolution: last-write wins and explicit merge (Priority: P1)

The same draft was changed offline on the web (or agent-adjacent workflow) and
also changed on the server (or another device) while disconnected. On sync, the
system applies **last-write wins** when changes do not conflict on the same
fields/state. When both sides changed overlapping content or lifecycle state in
incompatible ways (a **clash**), the user is taken to a dedicated **Conflict
UI**: they can choose keep local, keep server, or combine fields, then confirm.
Nothing is silently discarded without status visibility.

**Why this priority**: Multi-device and reconnect races are inevitable; unclear
conflict handling causes data loss or trust failure.

**Independent Test**: Prepare two divergent edits of the same draft (local
pending vs server version); sync; confirm non-overlapping edits resolve via
last-write without prompting; force an overlapping clash and confirm merge UI
requires an explicit choice before the document converges.

**Acceptance Scenarios**:

1. **Given** local and server versions differ only in non-overlapping fields,
   **When** sync runs, **Then** the merged result keeps both sides’ unique
   changes under last-write rules and marks the item synced without a merge
   prompt.
2. **Given** both sides changed the same critical fields or mutually exclusive
   statuses (a clash), **When** sync detects the clash, **Then** the item is
   marked **conflict**, the dedicated **Conflict UI** opens (or is reachable
   from the sync panel), and the user must complete an explicit merge (keep
   local, keep server, or field-level combine) before it becomes synced.
3. **Given** a conflict is open, **When** the user has not resolved it,
   **Then** automatic sync does not overwrite either side’s unresolved clash
   data and the indicator remains visible.
4. **Given** the user resolves a conflict, **When** sync completes,
   **Then** exactly one organization document version reflects the chosen
   resolution and the conflict indicator clears.

---

### User Story 4 - Sync status visibility across web and agent (Priority: P2)

Users need to trust offline work. The web app and agent surface consistent sync
states: synced, pending, syncing, conflict, failed (with retry). Counts of
pending/conflict items are visible at a glance (e.g., header or dedicated sync
panel) in Arabic and English with RTL support.

**Why this priority**: Status clarity prevents duplicate manual re-entry and
support tickets; secondary only to actual queue and conflict behavior.

**Independent Test**: Create pending and conflict items; confirm indicators and
counts update in ar and en; resolve/retry and confirm indicators clear.

**Acceptance Scenarios**:

1. **Given** at least one pending or failed sync item, **When** the user views
   the web shell or agent status UI, **Then** they see an unambiguous indicator
   and can open a list of affected items with status and next action.
2. **Given** connectivity is down, **When** the user views status, **Then** the
   UI indicates offline/disconnected distinctly from “synced”.
3. **Given** locale is Arabic, **When** sync labels and messages appear,
   **Then** copy is complete in Arabic and layout remains usable in RTL.

---

### User Story 5 - Guaranteed no data loss for queued work (Priority: P1)

Pending offline drafts and signed outcomes survive browser/app restart, agent
restart, and brief disk flush. Users are warned before destructive actions that
would discard unsynced work (e.g., clearing site data / uninstall) where the
product can detect that risk.

**Why this priority**: “No data loss” is an explicit product guarantee for this
feature; without durability, offline mode is unsafe for e-invoicing.

**Independent Test**: Create pending items, restart the client, confirm queue
intact; attempt a product-supported clear/logout path and confirm a warning when
unsynced items exist (or items remain until sync per policy).

**Acceptance Scenarios**:

1. **Given** pending offline items exist, **When** the user restarts the web
   app or agent and signs in to the same organization context, **Then** pending
   items are still present and retain their payloads.
2. **Given** unsynced items exist, **When** the user initiates a product action
   that would discard the local queue, **Then** they receive a clear warning and
   must confirm (or the action is blocked until sync/export of pending work).

---

### Edge Cases

- Connectivity flaps rapidly: sync must not thrash; backoff still applies and
  status remains coherent (not stuck forever in “syncing”).
- User edits a pending item again while a sync attempt is in flight: local
  newer revision must win or re-queue after the in-flight attempt completes
  without dropping the newer edit.
- Server deleted or voided a document that still has a local pending edit: clash
  / conflict path; do not silently recreate against policy if lifecycle forbids.
- Duplicate offline create of “same” business document (same internal id): sync
  must surface conflict or idempotent upsert rules so two server documents are
  not created unintentionally.
- Agent completes signature twice for the same job version due to retry: server
  accepts once (idempotent).
- Clock skew between devices: last-write uses authoritative timestamps
  (prefer server-ack time when available; otherwise document version / revision
  counters—not wall clock alone as sole authority when versions exist).
- Very large offline queue: user still sees counts and can sync; progress
  remains visible; no silent truncation.
- Session expired while offline: local drafts remain; upon reconnect user
  re-authenticates; queue then syncs under the restored organization context.
- Partial sync success (some items synced, some failed): statuses are per-item;
  successful items are not rolled back.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a local offline queue on the **web** client
  for draft document creates and updates when the organization API is
  unreachable, delivered as **PWA offline** capability with durable storage in
  **IndexedDB**.
- **FR-002**: System MUST provide a local offline queue on the **desktop agent**
  for signed document outcomes (and related job completion payloads) when the
  organization API is unreachable, using the agent’s existing **SQLite** queue
  (extend/reuse; no parallel offline store).
- **FR-003**: System MUST persist queued items durably across client restarts
  until they are successfully acknowledged by the organization or explicitly
  discarded by the user after warning.
- **FR-004**: System MUST automatically sync the queue when connectivity returns,
  using retry with exponential backoff for transient failures.
- **FR-005**: System MUST expose clear per-item and summary sync statuses at
  least: pending, syncing, synced, conflict, failed (user-visible labels in
  ar/en).
- **FR-006**: System MUST apply **last-write wins** for non-clashing concurrent
  edits during sync.
- **FR-007**: System MUST detect **clashes** (overlapping field or incompatible
  lifecycle changes) and require resolution through a dedicated **Conflict UI**
  (keep local, keep server, or field-level merge) before overwriting either side.
- **FR-008**: System MUST assign and honor an **idempotency key per document**
  so resync/retries never produce duplicate organization documents or duplicate
  signature/submission effects for that document.
- **FR-009**: System MUST guarantee that agent signature completion and
  subsequent submission handoff are idempotent (keyed per document / job
  version) so retries never duplicate signature attachment or authority
  submission for the same document version.
- **FR-010**: System MUST NOT lose queued draft or signed payloads due to a
  failed sync attempt; failures leave items in failed/pending for retry.
- **FR-011**: System MUST warn before product actions that would discard
  unsynced queue data.
- **FR-012**: System MUST scope all synced data to the user’s active
  organization; offline queues MUST NOT mix or leak across organizations.
- **FR-013**: System MUST record audit events for sync success, sync failure,
  conflict resolution, and idempotent replay detections (actor/device,
  organization, resource identity, outcome; no secrets).
- **FR-014**: Offline capability MUST NOT bypass existing authorization: only
  users/devices already allowed to manage documents or complete signing jobs may
  enqueue corresponding offline actions.
- **FR-015**: Sync of signed payloads MUST preserve byte integrity of the signed
  content; the organization MUST treat synced signatures under the same
  integrity rules as online completions (no re-canonicalization of signed
  bytes).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios and automated tests cover
  offline save, reconnect sync, conflict merge, and idempotent replay; audit
  events for sync and conflict resolution as in FR-013.
- **CC-002 Security**: Offline stores (web IndexedDB; agent SQLite) MUST protect
  organization data at rest on the device using platform-appropriate protection;
  no ETA client secrets or signing PINs in web local storage; TLS for all sync
  traffic when online; least-privilege reuse of existing authZ.
- **CC-003 Tenant Isolation**: Offline queues and sync APIs are organization-
  scoped; cross-organization leakage of queued drafts or signed payloads is
  release-blocking.
- **CC-004 ETA Serialization**: Offline sync MUST NOT alter canonical
  serialization or signed bytes; signature completion sync reuses existing
  parity/integrity gates; no new bulk-only serializer.
- **CC-005 Runtime ETA Config**: N/A for offline queue itself; any ETA submit
  after reconnect continues to use runtime organization credentials/URLs.
- **CC-006 Sandbox-First**: Post-reconnect submissions in non-production use
  sandbox/preprod configuration unchanged.
- **CC-007 UX/i18n**: Sync indicators, dedicated Conflict UI, and warnings ship
  in ar/en with RTL-safe layout and responsive behavior on web; agent status
  copy follows existing agent UX language patterns.
- **CC-008 Full-Stack Phase**: Backend sync/ack/idempotency contracts + web PWA
  offline queue/UI + agent SQLite queue/status delivered together for the
  stories in scope; no web-only or agent-only “done” for P1 stories that span
  both.

### Key Entities *(include if feature involves data)*

- **Offline Queue Item**: A locally durable unit of work (draft create/update,
  signature completion, or submit handoff) with organization id, actor/device,
  **per-document idempotency key**, payload, revision, sync status, timestamps,
  and last error. Web items live in IndexedDB; agent items live in SQLite.
- **Sync Status**: User-visible state of an item or summary (pending, syncing,
  synced, conflict, failed).
- **Conflict Record**: Pair of local vs server revisions for a clash, resolved
  only via the **Conflict UI** (keep local, keep server, merged fields).
- **Idempotency Key (per document)**: Stable identity bound to the document so
  retries and reconnects cannot duplicate server effects for that document.
- **Document Draft (synced)**: Organization document after successful draft
  sync; same lifecycle as online drafts.
- **Signed Outcome (synced)**: Organization-recorded signature completion for a
  job/document version after agent sync.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a controlled offline test, users can create at least 10 draft
  invoices offline and, after reconnect, all appear in the organization within
  2 minutes without duplicates (100% of successfully queued items either synced
  or visibly failed with retry).
- **SC-002**: Forcing the same signature-completion sync at least 5 times yields
  exactly one organization acceptance of that job version (zero duplicate
  signature rows / duplicate submissions for that version).
- **SC-003**: In clash scenarios, 100% of overlapping conflicts require explicit
  user resolution before the document is marked synced; non-clash divergent edits
  resolve without prompting.
- **SC-004**: After client restart with pending items, 100% of previously queued
  items remain available (no silent loss) in the test harness.
- **SC-005**: At least 90% of test users (or scripted UX checklist) correctly
  identify pending vs conflict vs failed vs synced from the UI without training
  beyond on-screen labels.
- **SC-006**: Mean time from reconnect to first successful sync attempt for a
  non-empty queue is under 15 seconds in the standard test environment (excluding
  intentional backoff after failures).

## Assumptions

- Offline web use requires an initial online login/session establishment; full
  cold-start registration while permanently offline is out of scope.
- Web offline drafts use **PWA** capabilities with **IndexedDB** as the durable
  local queue store; **install-to-home-screen is optional** (browser-tab offline
  is enough after an online visit that registers the service worker).
- Agent offline signed/job outcomes use the agent’s existing **SQLite** queue.
- Idempotency is **per document** across draft sync and signature/submit handoff.
- Clashes are resolved only through the dedicated **Conflict UI**.
- Scope is **document drafts** and **signed-document / job-completion /
  submit-handoff** queues—not offline editing of all settings, user admin, or
  bulk import jobs.
- Mobile native apps are out of scope; web (PWA/responsive) + desktop agent only.
- “Last-write wins” for non-clashes uses document revision / sync generation
  when available; wall-clock is a fallback only when revisions are equal.
- A **clash** means both sides changed the same field set or incompatible
  lifecycle states (e.g., local still editing draft vs server already marked
  ready/signed) since the last common revision.
- Explicit merge offers keep-local, keep-server, and field-level combine for
  draft content; lifecycle clashes may limit combine options (user must choose
  a valid resulting state).
- Authority (ETA) submission remains online-only after sync; offline mode queues
  handoff but does not call the authority while disconnected.
- Existing submission cooldown and digest self-check behavior remain in force
  after reconnect; offline sync must not bypass them.
- Multi-organization users keep separate offline queues per active organization
  context.
- Browser “clear site data” outside the product UI cannot always be intercepted;
  the product warns on supported logout/clear-queue actions and documents the
  residual risk for OS-level data wipes.
