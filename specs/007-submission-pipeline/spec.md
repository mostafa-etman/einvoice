# Feature Specification: Submission Pipeline (Batch + Async Results)

**Feature Branch**: `007-submission-pipeline`

**Created**: 2026-07-25

**Status**: Clarified

**Input**: User description: "Feature: Submission pipeline (batch + async results).
- BullMQ pipeline: sign → assemble a batch containing MULTIPLE documents → POST /api/v1.0/documentsubmissions/ → handle HTTP 202 (submissionUUID, acceptedDocuments, rejectedDocuments).
- Poll get-submission / get-document-details until validation completes; update per-document status (New, Submitted, Valid, Invalid, Cancelled).
- Handle errors: MaximumSizeExceeded (auto-split batch), DuplicateSubmission (respect Retry-After), IncorrectSubmitter/Forbidden (surface clearly). Respect rate limiting/backoff.
- Webhook receiver endpoints for ETA notifications (document status + package ready). Support Cancel/Reject/Decline. Download PDF printout.
Frontend: submission dashboard (statuses, filters), per-document error drilldown, retry, cancel/reject, PDF download."

## Clarifications

### Session 2026-07-25

- Q: What triggers submission? → A: **Manual trigger + queue-driven automation, in
  stages.** The primary trigger is **user-initiated** ("Submit" for one document,
  "Submit batch" for a multi-selection) so filing always has explicit consent. Once
  triggered, everything downstream is automatic: batching, sending, polling, status
  updates, and backoff retries for transient failures. Documents that come back
  **signed from the desktop agent are enqueued for submission automatically** (the
  user already consented by sending them for signature). An optional per-organization
  or per-branch **"auto-submit on create"** setting exists for power users,
  **default OFF**. **Scheduled/cron bulk auto-submission is explicitly out of scope**
  here and belongs to Bulk Import (later phase).
- Q: Are receiver-side reject/decline actions in scope? → A: **No.** This feature
  covers the lifecycle of **outgoing documents this organization issues**, so
  **Cancel** (within the authority's cancellation window) and **Reject** of documents
  **we issued** are in scope. Receiver-side **accept/reject/decline of documents other
  parties issued to this organization** operates on incoming documents and is
  **deferred to the Purchases feature**.
- Q: Where does the authority-mirrored status live? → A: **A local lifecycle status we
  own, separate from raw authority status, with an explicit mapping layer.** (1) The
  document carries **our** enum covering states the authority has no concept of plus
  post-submission states: `DRAFT`, `READY`, `PENDING_SIGNATURE`, `SIGNED`, `SUBMITTED`,
  `VALID`, `INVALID`, `CANCELLED`, `REJECTED`. (2) Raw authority data is stored
  **verbatim and separately**: raw status string, authority UUID, long id, submission
  reference, internal id, the **full validation-result payload** for audit and
  debugging, and the timestamp of the last sync. (3) **One mapping function**
  (authority raw status/validation result → our status) is used everywhere; mapping
  logic is never scattered. (4) A **status-event trail** records every transition with
  from-state, to-state, source (`system` | `eta` | `user`), a raw-payload snapshot, and
  timestamp, so any rejected or invalid document can be traced. Note: the existing
  `READY` state is retained and `PENDING_SIGNATURE` added, since documents already move
  DRAFT → READY before signing.
- Q: What are idempotency keys scoped to? → A: **Two layers.** A **batch-level
  idempotency key** on the submit action collapses repeated triggers (double click,
  retried job delivery) into one submission, and a **document-version key** unique per
  organization + document + version is enforced at the storage level as the hard
  guarantee that no version is filed twice through splitting, retries, or concurrency.
  A conflict on either key **returns the original outcome instead of an error** and is
  recorded for audit.
- Q: How should auto-split react to a size refusal? → A: **Recursive halving.** The
  refused batch is halved, each half retried, repeating down to a floor of one document;
  after any size refusal the **effective batch ceiling is lowered** for that
  organization's later batches. Batch limits (count and payload ceiling) are
  **configurable per environment with an optional per-organization override**, never
  hardcoded.
- Q: What is the polling schedule and stall cutoff? → A: **Exponential backoff from 5
  seconds, doubling, capped at 2 minutes**, so a terminal outcome is detected within ≤2
  minutes even with no notification; a submission unresolved after **24 hours** is
  flagged as stalled. A verified notification **short-circuits the schedule** by
  triggering an immediate confirmation check and resetting that document's backoff.
  Intervals, cap, and cutoff are per-environment configuration.
- Q: How is an `INVALID` document corrected and re-filed? → A: **Corrected in place as a
  new document version**, keeping the same internal id, then re-signed and re-submitted.
  Each version keeps **its own submission history**, so a superseded version's errors stay
  visible. Since the idempotency key is per version, the corrected version is submittable
  without weakening the duplicate guard on the already-filed version.

### Session 2026-07-25 (analyze remediation — 202 per-doc mapping)

- Q: How are ETA 202 accepted/rejected rows joined to our documents? → A: **Join by
  `internalId` only** — tenant-scoped `(tenantId, internalId)`. Array index /
  positional / `documentId` joins are forbidden (FR-004a). Assembler verifies
  `documents[].internalID ===` DB `internalId` before POST (FR-008-integrity). Exactly
  one `SubmissionDocument` per batched doc is created **before** POST.
- Q: Accepted vs rejected paths and filing lock? → A: **Accepted** → `ACCEPTED` +
  uuid/longId + Document `SUBMITTED` + create filing lock. **Rejected** →
  `REFUSED_AT_INTAKE` + intakeErrorJson + uuid/longId NULL + Document stays `SIGNED` +
  **no** lock (FR-004b). Lock is created **only on acceptance**, resolving the prior
  contradiction with FR-007c / FR-046 (I3).
- Q: Mixed-batch submission state and poll scope? → A: Mix → `PARTIALLY_ACCEPTED`;
  all accept → `SENT`; all reject → resolved/needs-attention with **no** poll
  (FR-004c). Poll enqueued for `ACCEPTED` only (FR-008e). Unmatched/missing
  `internalId` → needsAttention + audit; never invent uuid (FR-004d).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit signed documents to the tax authority in batches (Priority: P1)

An accountant has several signed invoices ready to file. They select them and press
"Submit batch" (or "Submit" on a single document). From that point the system works on
its own: it groups the documents into one or more batches, hands each batch to the tax
authority, and immediately records which documents were accepted for processing and
which were refused at intake, with a reason for each refusal.

**Why this priority**: Without accepted submissions nothing reaches the tax
authority; this is the reason the product exists. Everything else in this feature
enriches or corrects this flow.

**Independent Test**: Sign two or more documents, press "Submit batch", and confirm a
submission record exists with a tax-authority submission reference, each document is
marked either accepted-for-processing or refused-at-intake, and refused documents
show a human-readable reason.

**Acceptance Scenarios**:

1. **Given** three signed documents for one organization, **When** the user submits
   them as a batch, **Then** one submission record is created holding all three
   documents, and each document moves from `SIGNED` to `SUBMITTED`.
2. **Given** a batch where one document is refused at intake, **When** the authority
   responds with a mixed 202, **Then** Submission state is `PARTIALLY_ACCEPTED`, the
   two accepted documents become `SUBMITTED` with `etaUuid`/`etaLongId` set and a
   `DocumentFilingLock` created, the refused one stays `SIGNED` with attempt outcome
   `REFUSED_AT_INTAKE` plus `intakeErrorJson` and **no** uuid/longId/lock, and poll is
   enqueued only for the accepted documents.
3. **Given** a document that is not signed, **When** a user tries to submit it,
   **Then** submission is refused with a clear "must be signed first" message and no
   authority call is made.
4. **Given** a submission attempt while the organization's tax-authority credentials
   are missing, **When** submission runs, **Then** the attempt fails with an
   actionable configuration error and is retryable after credentials are set.
5. **Given** a document the user sent for signature earlier, **When** the desktop
   agent returns it signed, **Then** it is enqueued for submission automatically
   without a second user action.
6. **Given** the organization has left "auto-submit on create" off (the default),
   **When** a document is created and reaches `SIGNED` without any submit action,
   **Then** it stays `SIGNED` until a user submits it.

---

### User Story 2 - See the final validation outcome per document without manual chasing (Priority: P2)

Submission acceptance is not the final answer: the authority validates
asynchronously. The system keeps checking until each document reaches a terminal
outcome and shows the result per document, including the specific validation errors
for anything invalid.

**Why this priority**: An accountant cannot rely on "submitted"; the business
outcome is "valid" (legally filed) or "invalid" (must be fixed and re-filed).

**Independent Test**: Submit a batch against the authority sandbox, wait for
resolution, and confirm every document ends in `VALID` or `INVALID`, with the
authority's error list stored and viewable per document.

**Acceptance Scenarios**:

1. **Given** a submitted batch still under validation, **When** the system checks
   status, **Then** documents remain `SUBMITTED` and the next check is scheduled on the
   backoff schedule (5s doubling to a 2-minute cap) without user action.
2. **Given** validation completes successfully, **When** the system checks status,
   **Then** the shared mapping function sets the document to `VALID` and the authority's
   raw status, long id, short id (if provided), full validation payload, and sync
   timestamp are stored verbatim alongside it.
3. **Given** validation fails, **When** the system checks status, **Then** the
   document becomes `INVALID` and every authority error (code, target/field, message)
   is stored and shown in a per-document drilldown.
4. **Given** a document has reached a terminal outcome, **When** further checks would
   run, **Then** polling stops for that document.
5. **Given** any status change, **When** it is applied, **Then** a status event records
   from-state, to-state, source, raw authority payload snapshot, and timestamp.

---

### User Story 3 - Recover automatically from authority-side limits and refusals (Priority: P2)

Submissions hit real-world limits: batches too large, accidental resubmission of the
same document, wrong submitting organization, permission problems, and rate limits.
The system reacts correctly per case instead of failing generically, and a user can
retry deliberately when the cause is fixed.

**Why this priority**: Without this, ordinary daily volume produces stuck or
silently failed filings that require engineering intervention.

**Independent Test**: Force each error class (oversize batch, duplicate submission,
wrong submitter, permission denied, rate limited) and confirm the documented reaction
occurs and is visible in the submission record.

**Acceptance Scenarios**:

1. **Given** a batch the authority refuses as too large, **When** the refusal is
   received, **Then** the system halves the batch, retries each half automatically
   without duplicating any document, and lowers the effective ceiling for later batches.
2. **Given** a batch containing a document the authority reports as already
   submitted, **When** the refusal includes a wait instruction, **Then** the system
   waits at least that long before retrying and does not create a second filing for
   that document.
3. **Given** the authority reports the submitting organization is incorrect or not
   permitted, **When** the refusal is received, **Then no** blind retry occurs and the
   submission surfaces a clear, actionable message naming the configuration to fix.
4. **Given** the authority rate limits or is temporarily unavailable, **When**
   requests fail, **Then** the system backs off progressively, retries within a
   bounded attempt budget, and marks the submission as needing attention if the
   budget is exhausted.
5. **Given** a submission that failed for a fixable reason, **When** a user with
   document management permission retries it, **Then** only unresolved documents are
   re-submitted and already-`VALID` documents are never re-sent.
6. **Given** an `INVALID` document, **When** the user corrects it, **Then** a new
   document version is created under the same internal id, it must be signed again before
   re-submission, and the previous version's validation errors remain visible.

---

### User Story 4 - Work the day from a submission dashboard (Priority: P2)

A finance user opens one screen that shows every submission and document status,
filters to what needs action (invalid, refused, needs attention), drills into a
document's errors, and retries from there.

**Why this priority**: The pipeline's value is only realized if a non-technical user
can see and act on outcomes; this is the primary human interface of the feature.

**Independent Test**: With a mix of submissions in every state, confirm the dashboard
lists them, filters by status/date/branch, opens a per-document error drilldown, and
exposes retry where allowed — in both Arabic (RTL) and English.

**Acceptance Scenarios**:

1. **Given** submissions in several states, **When** the user opens the dashboard,
   **Then** each submission shows its state, document counts by outcome, and time of
   last update.
2. **Given** the user filters by status "Invalid", **When** the filter applies,
   **Then** only documents with validation failures are listed.
3. **Given** an invalid document, **When** the user opens its drilldown, **Then**
   every authority error is listed with code, field/target, and message in the
   selected language where a translation exists.
4. **Given** the user has view-only permission, **When** they open the dashboard,
   **Then** retry, cancel, and reject actions are not available.

---

### User Story 5 - Learn outcomes faster via authority notifications (Priority: P3)

The tax authority can notify the system when a document changes status or when a
requested package is ready. The system accepts these notifications and uses them to
update outcomes sooner than scheduled checking would.

**Why this priority**: A latency and load optimization; correctness must not depend
on notifications arriving.

**Independent Test**: Post a valid notification for a submitted document and confirm
the outcome updates promptly, and that an unverified or replayed notification is
rejected or safely ignored without changing data.

**Acceptance Scenarios**:

1. **Given** a document awaiting validation, **When** a verified status notification
   arrives, **Then** the system confirms the outcome against the authority before
   applying it and updates the document.
2. **Given** a notification that fails verification, **When** it is received,
   **Then** it is rejected, no data changes, and the attempt is recorded for audit.
3. **Given** the same notification is delivered twice, **When** both are processed,
   **Then** the resulting document state is identical to processing it once.
4. **Given** notifications stop arriving entirely, **When** time passes, **Then**
   scheduled checking still resolves every document to a terminal outcome.

---

### User Story 6 - Cancel or reject a document we issued (Priority: P3)

Within the authority's allowed time window, an authorized user can cancel or reject a
document their own organization issued, always supplying a reason. Responding to
documents that *other* parties issued to this organization is not part of this feature.

**Why this priority**: Legally required corrective actions, but they follow the
successful filing path and apply to a smaller share of daily volume.

**Independent Test**: Cancel a `VALID` issued document inside the window with a
reason and confirm it becomes `CANCELLED`; attempt the same outside the window and
confirm a clear refusal.

**Acceptance Scenarios**:

1. **Given** a `VALID` document inside the cancellation window, **When** an
   authorized user cancels it with a reason, **Then** the authority request is made
   and the document becomes `CANCELLED` once accepted.
2. **Given** a document outside the allowed window, **When** cancellation is
   attempted, **Then** it is refused with an explanation of the window and the
   document state is unchanged.
3. **Given** a cancellation request that the authority refuses, **When** the response
   arrives, **Then** the document keeps its previous state and the refusal reason is
   shown.
4. **Given** any cancel or reject action on an issued document, **When** it completes
   or fails, **Then** the actor, target document, reason, and outcome are recorded in
   the audit log.
5. **Given** a document another party issued to this organization, **When** a user
   looks for accept/reject/decline actions, **Then** none are offered here because
   incoming documents are handled by the Purchases feature.

---

### User Story 7 - Download the official printout (Priority: P3)

A user downloads the authority's PDF printout for a valid document to share with a
customer or archive it, and can retrieve a prepared package when the authority
signals it is ready.

**Why this priority**: Needed for real business use but strictly after a document is
valid; not required to prove the pipeline works.

**Independent Test**: For a `VALID` document, request the printout and confirm a PDF
is returned; repeat and confirm the second request does not require a new authority
fetch.

**Acceptance Scenarios**:

1. **Given** a `VALID` document, **When** the user requests the printout, **Then** a
   PDF is returned and stored for reuse under that organization only.
2. **Given** a document that is not yet valid, **When** a printout is requested,
   **Then** the request is refused with a clear reason.
3. **Given** a previously downloaded printout, **When** requested again, **Then** the
   stored copy is served without a redundant authority request.
4. **Given** a user from another organization holding a printout link, **When** they
   request it, **Then** access is denied.

---

### Edge Cases

- A single document alone exceeds the authority's maximum submission size, so
  splitting cannot help: the document is marked as needing attention with a
  size-specific reason rather than retried forever.
- Only part of a batch is accepted: accepted and refused documents must diverge
  cleanly (FR-004b), Submission state becomes `PARTIALLY_ACCEPTED` (FR-004c), poll is
  enqueued only for accepted docs (FR-008e), and a retry of the batch must not
  resubmit accepted (locked) documents.
- An ETA `internalId` unknown to the batch, OR a batched document missing from
  **both** `acceptedDocuments` and `rejectedDocuments`: mark needsAttention, write an
  audit log entry, and **never invent** a `uuid`/`longId` mapping (FR-004d).
- The same document is submitted twice concurrently (double click, duplicate job): the
  document-version idempotency key rejects the second attempt at storage level and the
  caller receives the original submission's outcome.
- A document is edited after submission but before validation completes: the recorded
  outcome must remain bound to the exact submitted version.
- Authority credentials are revoked or rotated mid-flight: in-flight work fails with a
  configuration error and resumes after correction, without losing submissions.
- The authority returns a success acknowledgement but no submission reference, or an
  unparseable body: the attempt is treated as unknown-outcome and reconciled by a
  lookup before any retry, to avoid double filing.
- Validation never completes within 24 hours: the submission is flagged as stalled for
  operator attention and leaves the normal checking schedule instead of polling
  indefinitely.
- Notifications arrive out of order or for unknown documents/organizations: they are
  ignored safely and recorded.
- Clock skew or time zone differences between local timestamps and authority
  timestamps must not change terminal outcomes.
- The printout is requested for a document whose authority package is not yet
  generated: the user gets a "not ready yet" answer, not an error page.
- Bulk day-end volume creates many batches at once: rate limits must be respected
  organization by organization without one organization starving another.
- A user submits a selection that mixes submittable and non-submittable documents:
  eligible documents proceed and ineligible ones are reported per document, rather
  than failing the whole action.
- "Auto-submit on create" is enabled but a document is not yet signed: it must wait
  for signing rather than being submitted unsigned or dropped.

## Requirements *(mandatory)*

### Functional Requirements

**Triggering** *(added by clarification session 2026-07-25)*

- **FR-038**: Users with document management permission MUST be able to trigger
  submission explicitly for a single document ("Submit") or for a multi-selection
  ("Submit batch"); explicit consent is the primary trigger.
- **FR-039**: After a trigger, the pipeline MUST proceed without further user action:
  batching, sending, status checking, status updates, and backoff retries for transient
  failures all happen automatically.
- **FR-040**: A document returned signed by the desktop signing agent MUST be enqueued
  for submission automatically, since the user consented when sending it for signature.
- **FR-041**: System MUST provide an optional per-organization and per-branch
  "auto-submit on create" setting, **defaulting to OFF**, so explicit consent remains
  the default behavior.
- **FR-042**: System MUST NOT provide scheduled or time-triggered bulk auto-submission
  in this feature; that capability belongs to the later Bulk Import feature.

**Batch assembly & submission**

- **FR-001**: System MUST submit only documents that are signed and not already
  filed, and MUST refuse submission of unsigned or already-`VALID` documents.
- **FR-002**: System MUST assemble batches containing **multiple documents** per
  submission, grouped per organization, and MUST record the exact set of documents in
  each batch attempt.
- **FR-003**: System MUST cap batch size by both document count and payload size to
  stay below the authority's published submission limit before sending.
- **FR-004**: System MUST record, for each submission attempt, the authority
  submission reference, the documents accepted for processing, and the documents
  refused at intake with their error details. (Identifiers after accept/poll are
  also covered by FR-009; FR-004 is specifically the 202 intake recording.)
- **FR-004a**: The **ONLY** join key between an ETA HTTP 202 body and our rows is
  `internalId`, matched tenant-scoped as `(tenantId, internalId)`. System MUST match
  `acceptedDocuments[].internalId` and `rejectedDocuments[].internalId` to our
  `Document.internalId` / `SubmissionDocument.internalId`. Joining by array index,
  positional order, or any `documentId` assumption is **FORBIDDEN** — ETA's 202
  arrays are not ordered to our input and contain no `documentId`.
- **FR-004b**: Accepted vs rejected at intake are two normative paths. **Accepted:**
  set `SubmissionDocument.attemptOutcome = ACCEPTED`, set `etaUuid` + `etaLongId`,
  set Document local status → `SUBMITTED`, and create `DocumentFilingLock`.
  **Rejected at intake:** set `SubmissionDocument.attemptOutcome = REFUSED_AT_INTAKE`,
  store `intakeErrorJson`, leave `etaUuid`/`etaLongId` **NULL**, leave Document
  local status **`SIGNED`** (re-submittable), and **MUST NOT** create a filing lock.
- **FR-004c**: After applying a 202 body, Submission state MUST be set as: any mix of
  accept + reject → `PARTIALLY_ACCEPTED`; all accepted → `SENT` (until poll resolves);
  all rejected → resolved/`NEEDS_ATTENTION` with **no** poll enqueued.
- **FR-004d**: If ETA returns an `internalId` unknown to the batch, or a batched
  document is missing from **both** `acceptedDocuments` and `rejectedDocuments`,
  System MUST mark the submission (and affected docs) as needing attention, write an
  audit log entry, and **MUST NEVER invent** a `uuid`/`longId` mapping.
- **FR-005**: System MUST guarantee at-most-one successful filing per document
  version, even under concurrent triggers or retries. The filing lock that enforces
  this (FR-046) is created **only on acceptance** (FR-004b), not on refused rows.
- **FR-006**: System MUST process submissions asynchronously so that a user action
  never blocks on authority round-trips.
- **FR-045**: Every submit action MUST carry a **batch-level idempotency key**, so a
  repeated trigger with the same key (double click, retried job delivery, duplicate
  request) does not create a second submission.
- **FR-046**: System MUST enforce a **document-version idempotency key** — unique per
  organization, document, and document version — at the storage level, so no document
  version can be filed twice through batch splitting, retries, or concurrent triggers.
  The corresponding `DocumentFilingLock` MUST be created **only when** that document
  appears in `acceptedDocuments` (FR-004b); refused-at-intake documents MUST NOT
  acquire the lock.
- **FR-047**: A conflict on either idempotency key MUST return the **original**
  submission outcome rather than an error, and the conflict MUST be recorded for audit.
- **FR-048**: Idempotency keys MUST be organization-scoped and retained with the
  submission record for audit and duplicate-diagnosis purposes.

**Status lifecycle & polling**

- **FR-007**: System MUST track a **local document lifecycle status that the product
  owns**, covering `DRAFT`, `READY`, `PENDING_SIGNATURE`, `SIGNED`, `SUBMITTED`,
  `VALID`, `INVALID`, `CANCELLED`, and `REJECTED`. This status MUST NOT be overloaded
  with the authority's raw status string.
- **FR-007a**: System MUST store raw authority data **verbatim and separately** from the
  local status: the authority's raw status value, authority document UUID, long id,
  submission reference, internal id, the **complete validation-result payload** as
  returned, and the timestamp of the last successful sync.
- **FR-007b**: System MUST translate authority status and validation results into the
  local status through **one shared mapping function**; no component may implement its
  own status-mapping logic.
- **FR-007c**: A document refused at intake MUST retain its pre-submission local status
  so it remains submittable, while the refusal is recorded as that attempt's outcome
  (`REFUSED_AT_INTAKE`) and is filterable in the dashboard.
- **FR-007d**: "Needs attention" MUST be represented as a separate condition (exhausted
  retry budget or stalled validation), not as a local lifecycle status value, so it can
  coexist with any status.
- **FR-008**: System MUST check submission and document status repeatedly until every
  document reaches a terminal outcome, and MUST stop checking terminal documents.
- **FR-008a**: Status checking MUST follow **exponential backoff starting at 5 seconds,
  doubling, capped at 2 minutes**, so a terminal outcome is detected within at most 2
  minutes of the authority producing it even with no notification.
- **FR-008b**: A submission whose documents have not reached a terminal outcome within
  **24 hours** MUST be flagged as stalled/needing attention and MUST stop consuming the
  normal checking schedule.
- **FR-008c**: A verified notification MUST **short-circuit the schedule**: it triggers
  an immediate confirmation check for the affected document and resets that document's
  backoff interval.
- **FR-008d**: Checking intervals, the interval cap, and the stall cutoff MUST be
  configurable per environment and MUST NOT be hardcoded.
- **FR-008-integrity**: Before `POST` to the authority, the batch assembler MUST set
  and verify that every payload `documents[].internalID` equals our DB
  `Document.internalId` for that row (tenant-scoped). If any mismatch is found,
  System MUST fail the submission attempt without calling the authority.
  (Payload-integrity test T013 MUST cover this check.)
- **FR-008e**: Poll jobs MUST be enqueued only for documents with attempt outcome
  `ACCEPTED` (or as a submission-level poll that updates **only** `ACCEPTED`
  rows). System MUST NEVER poll refused-at-intake documents.
- **FR-009**: System MUST persist authority-issued identifiers (submission reference,
  document long id, short id when present) and the validation timestamp.
- **FR-010**: System MUST persist the full authority validation error list per
  document, preserving error code, target/field, and message.
- **FR-011**: System MUST treat status transitions as idempotent, so repeated reads or
  notifications cannot produce conflicting or duplicated history.
- **FR-012**: System MUST record a **status-event trail** per document capturing
  from-state, to-state, source (`system`, `eta`, or `user`), a snapshot of the raw
  authority payload that caused the change, and the timestamp — sufficient to trace
  every transition of a rejected or invalid document without re-querying the authority.

**Error handling & throttling**

- **FR-013**: When the authority refuses a batch as too large, System MUST split the
  batch into smaller batches and resubmit automatically, without duplicating
  documents and without losing any document from the original set.
- **FR-013a**: Splitting MUST use **recursive halving**: the refused batch is divided in
  two, each half is retried, and halving repeats on further refusals down to a floor of
  one document per batch.
- **FR-013b**: After a size refusal, System MUST **lower the effective batch ceiling**
  used for subsequent batches in that organization, so the same over-estimate is not
  repeated.
- **FR-013c**: Batch limits (document count and payload size ceiling) MUST be
  configurable per environment, with an optional per-organization override, and MUST NOT
  be hardcoded.
- **FR-014**: When a document is refused as a duplicate submission, System MUST honor
  any wait instruction supplied by the authority before retrying and MUST reconcile
  the existing filing instead of creating a second one.
- **FR-015**: When the authority reports an incorrect submitter or refuses on
  permission grounds, System MUST NOT auto-retry and MUST surface an actionable
  message identifying the configuration at fault.
- **FR-016**: System MUST apply progressive backoff with jitter to throttled and
  transient authority failures, MUST bound total attempts, and MUST mark work as
  needing attention when the budget is exhausted.
- **FR-017**: System MUST enforce per-organization request pacing so one
  organization's volume cannot exhaust another organization's authority throughput.
- **FR-018**: Users with document management permission MUST be able to retry a failed
  or partially failed submission, and retry MUST re-send only documents without a
  terminal successful outcome.
- **FR-018a**: An `INVALID` document MUST be correctable **in place as a new document
  version**, keeping its internal id, and MUST then follow the normal signing path before
  it can be re-submitted.
- **FR-018b**: Each document version MUST retain its **own submission history**, so the
  errors of a superseded version stay visible after a later version is filed.
- **FR-018c**: Because the idempotency key is per document version (FR-046), a corrected
  version MUST be submittable without weakening the duplicate guard on the version that
  was already filed.

**Notifications (webhooks)**

- **FR-019**: System MUST expose receiver endpoints for authority notifications
  covering document status changes and package-ready events.
- **FR-020**: System MUST verify the authenticity of every notification before acting
  on it, MUST resolve it to exactly one organization, and MUST reject unverifiable
  notifications.
- **FR-021**: System MUST treat notifications as hints only: the authoritative status
  MUST be confirmed with the authority before a document's outcome is changed.
- **FR-022**: System MUST process duplicate or out-of-order notifications without
  changing the final document state (idempotent handling) and MUST record every
  received notification for audit.
- **FR-023**: System MUST reach terminal outcomes for all documents even when no
  notification is ever delivered.

**Lifecycle actions**

- **FR-024**: Authorized users MUST be able to cancel a filed document the
  organization issued, supplying a reason, and System MUST reflect the authority's
  accepted result as `CANCELLED`.
- **FR-025**: Authorized users MUST be able to reject a document the organization
  issued, supplying a reason, and System MUST reflect the authority's accepted result.
- **FR-043**: System MUST limit lifecycle actions to **outgoing documents this
  organization issued**. Receiver-side accept/reject/decline of documents issued **to**
  this organization is out of scope and MUST NOT be exposed here; it belongs to the
  Purchases feature.
- **FR-026**: System MUST refuse lifecycle actions outside the authority's allowed
  time window or invalid for the document's current state, with an explanatory
  message and no state change.
- **FR-027**: System MUST leave document state unchanged when the authority refuses a
  lifecycle action and MUST surface the refusal reason.

**Printout & packages**

- **FR-028**: Users MUST be able to download the authority PDF printout for a `VALID`
  document, and System MUST refuse printout requests for non-valid documents.
- **FR-029**: System MUST store retrieved printouts and packages per organization and
  serve subsequent requests from storage instead of re-fetching.
- **FR-030**: System MUST deny access to printouts and packages requested by any
  organization other than the owning one.

**Dashboard & UX**

- **FR-031**: System MUST provide a submission dashboard listing submissions and
  per-document outcomes with counts, last-updated time, and filters by local status,
  intake-refused attempts, needs-attention condition, date range, branch, and document
  type.
- **FR-032**: System MUST provide a per-document error drilldown showing every
  authority validation error with code, target/field, and message.
- **FR-033**: System MUST expose submit, retry, cancel, and reject actions only to
  users holding the corresponding management permission, and MUST hide or disable them
  for view-only users.
- **FR-034**: Dashboard and drilldown MUST be available in Arabic (RTL) and English
  and MUST be responsive across supported breakpoints.
- **FR-044**: Dashboard MUST support selecting multiple submittable documents and
  submitting them as one batch, and MUST report per-document outcomes of that batch
  back to the user.

**Audit & observability**

- **FR-035**: System MUST audit submission triggered, created, submitted, accepted,
  refused, validated, retried, cancelled, rejected, printout downloaded, and
  notification received/rejected, with actor, organization, timestamp, and outcome.
  Automatic triggers MUST record the originating cause (agent-signed enqueue or
  auto-submit setting) instead of a user actor.
- **FR-036**: System MUST NOT write authority credentials, tokens, notification
  secrets, or signature material into logs, audit payloads, or client responses.
- **FR-037**: System MUST expose operational counts of submissions and documents by
  state, including work needing attention, for monitoring.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Every acceptance scenario above maps to automated
  tests (submission intake, status resolution, each error class, notification
  verification, lifecycle actions, printout access). Audit events per FR-035 with
  actor, organization, timestamp, action, outcome; error codes only, no payload
  secrets.
- **CC-002 Security**: Authority credentials remain encrypted at rest and are used
  server-side only; notification receivers require verification (FR-020); printout and
  package links are access-controlled (FR-030); no secrets in logs or bundles
  (FR-036); all authority traffic over TLS.
- **CC-003 Tenant Isolation**: Submissions, submission-document results, validation
  errors, notifications, printouts, and packages are organization-scoped with
  row-level security plus application checks; queue keys and object-storage paths are
  organization-prefixed; cross-organization access is a release blocker and must be
  covered by isolation tests (FR-030).
- **CC-004 ETA Serialization**: This feature submits payloads produced by the existing
  document building and signing path; it MUST NOT re-canonicalize, reorder, or mutate
  signed content. Regression coverage: existing locked golden vectors and the
  cross-runtime parity harness must remain green, and a test must assert the submitted
  bytes equal the signed bytes.
- **CC-005 Runtime ETA Config**: Authority base URLs, endpoints, submission size
  limits, polling intervals, retry budgets, and notification secrets come from
  per-environment configuration; document type schemas continue to be loaded at
  runtime. No live-call literals in source.
- **CC-006 Sandbox-First**: Development and CI target the authority sandbox/preprod;
  live submission tests are gated and never run against production by default.
  Production submission requires explicit environment provisioning.
- **CC-007 UX/i18n**: Dashboard, filters, drilldown, and action dialogs use the shared
  design system with Arabic/RTL and English copy, and are responsive (FR-034).
- **CC-008 Full-Stack Phase**: Backend pipeline plus frontend dashboard ship together
  with tests. The desktop signing agent is unchanged by this feature; the pipeline
  starts from already-signed documents.

### Key Entities *(include if feature involves data)*

- **Submission**: One batch attempt sent to the authority for one organization.
  Holds the batch-level idempotency key, the authority submission reference, attempt
  number, parent submission when produced by a split, state (assembling, sent, partially
  accepted, resolved, needs attention), counts by outcome, and timestamps.
  Organization-scoped.
- **SubmissionDocument**: The join between a submission attempt and one document
  version, created **before** POST with `internalId` set. Carries attempt outcome
  (`ACCEPTED`, `REFUSED_AT_INTAKE`, `VALID`, `INVALID`, …). On accept: `etaUuid` +
  `etaLongId` required. On refuse: those fields **NULL**, `intakeErrorJson` set.
  Joined to ETA 202 rows **only** by `(tenantId, internalId)`. Organization-scoped.
- **DocumentLifecycleStatus**: The local status the product owns on the document
  (`DRAFT`, `READY`, `PENDING_SIGNATURE`, `SIGNED`, `SUBMITTED`, `VALID`, `INVALID`,
  `CANCELLED`, `REJECTED`), plus a separate needs-attention condition that can coexist
  with any status.
- **EtaStatusSnapshot**: The raw authority data held verbatim next to the local status —
  raw status value, authority document UUID, long id, submission reference, internal id,
  complete validation-result payload, and last-sync timestamp. Never merged into the
  local status.
- **DocumentStatusEvent**: One recorded transition with from-state, to-state, source
  (`system`, `eta`, `user`), the raw authority payload snapshot that caused it, and its
  timestamp. Append-oriented; the audit trail for rejected and invalid documents.
- **ValidationError**: One authority-reported problem for a document, with error
  code, target/field, message, and whether it came from intake refusal or validation.
- **AuthorityNotification**: A received notification event with its kind (document
  status, package ready), verification result, resolved organization, payload
  reference, processing outcome, and deduplication key.
- **DocumentArtifact**: A stored authority-produced file (PDF printout or prepared
  package) with its kind, source document or package reference, storage location, and
  organization scope.
- **RetryPolicyState**: The per-submission attempt budget, next-attempt time, last
  failure classification, and any authority-instructed wait, used to drive backoff and
  needs-attention decisions.
- **SubmissionTriggerSetting**: The per-organization and per-branch "auto-submit on
  create" toggle (default OFF) plus who last changed it, governing whether documents
  may be submitted without an explicit user action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of signed documents that a user submits reach a terminal outcome
  (`VALID`, `INVALID`, `CANCELLED`, or `REJECTED`), return to `SIGNED` after an intake
  refusal, or are explicitly flagged as needing attention — none remain silently stuck.
- **SC-002**: No document is ever filed with the authority more than once for the same
  version, verified under concurrent submission and retry scenarios.
- **SC-003**: A batch refused for exceeding the size limit is resubmitted automatically
  as halved batches — converging within at most log₂(batch size) rounds — with zero
  documents lost and zero duplicated.
- **SC-004**: 95% of accepted documents show their final validation outcome in the
  dashboard within 5 minutes of the authority completing validation, and no document
  takes longer than 2 minutes to detect a completed outcome once checking resumes.
- **SC-005**: For every invalid document, a user can see the specific authority error
  reasons without contacting support, in at most two clicks from the dashboard.
- **SC-006**: Throttling and transient authority failures produce zero permanent data
  loss; work resumes automatically once the authority recovers.
- **SC-007**: A day-end burst of at least 500 signed documents is submitted and fully
  resolved without manual intervention and without exceeding authority rate limits.
- **SC-008**: Unverified or replayed notifications cause zero data changes in 100% of
  attempts.
- **SC-009**: Zero cross-organization visibility of submissions, errors, printouts, or
  packages, demonstrated by automated isolation tests.
- **SC-010**: The dashboard, filters, and drilldown are fully usable in Arabic (RTL)
  and English with no untranslated user-facing strings.
- **SC-011**: With default settings, zero documents are filed without either an
  explicit user submit action or a prior user request to sign that document.
- **SC-012**: A user can submit a selection of at least 50 documents in one action and
  needs no further interaction until outcomes appear.

## Assumptions

- Documents arriving at this pipeline are already built and signed by the existing
  document and signing features; this feature never alters signed content.
- Explicit user submission is the default path; automation applies after a trigger
  (queue-driven processing) and to agent-signed documents, whose consent was given when
  the user sent them for signature.
- The "auto-submit on create" setting ships OFF, so no organization changes behavior on
  upgrade.
- Each organization's authority credentials and environment configuration already
  exist from the earlier integration work and are reused here.
- The authority acknowledges submissions asynchronously: acceptance at intake is not
  a validation result, so both a scheduled checking loop and notifications are needed.
- Batch grouping is per organization by default; grouping additionally by branch or
  document type is an optimization, not a requirement.
- Notifications are treated as untrusted hints; the authority remains the source of
  truth for any status change (FR-021), so correctness never depends on notification
  delivery.
- Cancellation and rejection windows and eligibility rules for issued documents are
  defined by the authority; the system enforces them by asking the authority and
  surfacing its answer, rather than by hardcoding legal windows.
- Printouts and packages are fetched on demand and cached in organization-scoped
  object storage; they are not pre-fetched for every valid document.
- Retry is a user-visible action for fixable failures; automatic retries are reserved
  for transient and size-related failures.
- Correcting an invalid document produces a new version of the same document rather than
  a new document, so the document editing and signing features already in place are
  reused for the correction loop.
- Batch limits, checking intervals, the interval cap, and the stall cutoff are
  configuration values with environment defaults; per-organization batch overrides sit
  alongside the auto-submit setting.
- Non-production environments target the authority sandbox/preprod, so end-to-end
  acceptance evidence comes from sandbox submissions.
- Out of scope for this feature: scheduled/cron bulk auto-submission (Bulk Import),
  receiver-side handling of documents issued to this organization (Purchases), and
  reporting or analytics beyond the submission dashboard (for example tax return
  summaries).
