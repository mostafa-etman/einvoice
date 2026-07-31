# Research: Submission Pipeline

**Feature**: `007-submission-pipeline` | **Date**: 2026-07-25

## R1 — Queue topology (sign / submit / poll)

**Decision**: Three BullMQ queues, all Redis-backed, jobs always include
`tenantId` + document/submission ids:

| Queue | Responsibility |
|-------|----------------|
| `sign` | Optional bridge: when signing intake completes and FR-040 applies, enqueue submit; also used if software-key signing ever runs server-side (not MVP) |
| `submit` | Assemble batch ≤ ceiling → verify internalID (FR-008-integrity) → POST → apply 202 by internalId (FR-004a/b) → enqueue poll for ACCEPTED only |
| `poll` | Exponential backoff 5s→2m (FR-008a); `GET .../documentsubmissions/{uuid}` and/or document details; apply `eta-status-map`; stop on terminal or 24h stall |

**Rationale**: Isolates Retry-After delays and rate limits on submit from poll
cadence; matches user technical plan; aligns with clarified FR-008a–d.

**Alternatives considered**: Single queue (harder delay semantics); Nest
`@Cron` only (weaker per-job backoff, worse multi-instance).

## R2 — ETA submit contract

**Decision**: Call `POST {ETA_API_BASE_URL}/api/v1.0/documentsubmissions/` with
`Content-Type: application/json`, Bearer token from existing `EtaAuthClient`.
Body: `{ documents: [ ...signed etaPayloadJson objects... ] }` — **byte-equal**
to stored signed payloads (no re-serialize). Before POST, verify every
`documents[].internalID ===` DB `Document.internalId` (FR-008-integrity). Expect
**HTTP 202** with `submissionUUID`, `acceptedDocuments[]` (`uuid`, `longId`,
`internalId`), `rejectedDocuments[]` (`internalId`, `error`).

**Rationale**: Official ETA Submit Documents API; clarified FR-004 / FR-009 /
FR-008-integrity (analyze I1/I8).

**Alternatives considered**: One-doc-at-a-time only (violates multi-doc batch
requirement).

## R2a — 202 per-document result mapping (closes analyze I1–I8)

**Decision**:

1. **Join key**: `(tenantId, internalId)` only. Match
   `acceptedDocuments[].internalId` / `rejectedDocuments[].internalId` to
   `SubmissionDocument.internalId`. **Forbid** array-index, positional, or
   `documentId` joins — ETA arrays are unordered relative to our input and have
   no `documentId`.
2. **Pre-rows**: Create exactly one `SubmissionDocument` per batched doc
   **before** POST, with `internalId` copied from DB.
3. **Accepted path**: `ACCEPTED` + set `etaUuid`/`etaLongId` + Document
   `SUBMITTED` + create `DocumentFilingLock`.
4. **Rejected path**: `REFUSED_AT_INTAKE` + `intakeErrorJson` + `etaUuid`/
   `etaLongId` NULL + Document stays `SIGNED` + **no** lock.
5. **Submission state**: mix → `PARTIALLY_ACCEPTED`; all accept → `SENT`; all
   reject → resolved/needs-attention with **no** poll.
6. **Poll**: enqueue for `ACCEPTED` only (never refused).
7. **Unmatched/missing `internalId`**: needsAttention + audit; never invent uuid.

**Rationale**: Wrong attribution would assign an ETA uuid to the wrong invoice in
the same batch — highest-risk US1 defect (analyze I1–I8).

**Alternatives considered**: Join by request array order (unsafe); lock on
enqueue before 202 (blocks re-submit of refused docs — contradicts FR-007c).

## R3 — Error classification

**Decision**:

| ETA signal | App reaction |
|------------|--------------|
| `400 MaximumSizeExceeded` | Recursive **halve** batch; lower effective ceiling; never drop docs (FR-013a–b). Single oversize doc → needs attention |
| `422 DuplicateSubmission` | Read `Retry-After` (seconds); delay job ≥ that value; do not create second filing; reconcile via poll if UUID known |
| `403 IncorrectSubmitter` / `403 Forbidden` | **No** auto-retry; mark needs attention; surface actionable config message (FR-015) |
| `429 TooManyRequests` / `503` | Progressive backoff + jitter; honor `Retry-After` when present; per-tenant pacing (FR-016–017) |
| Network / 5xx | Bounded retries then needs attention |

**Rationale**: ETA SDK docs + clarified US3.

**Alternatives considered**: Blind retry on all 4xx (dangerous for 403).

## R4 — Status model + mapping

**Decision**: Extend local `DocumentStatus` enum to
`DRAFT | READY | PENDING_SIGNATURE | SIGNED | SUBMITTED | VALID | INVALID |
CANCELLED | REJECTED`. Store raw ETA fields separately (`etaStatus`,
`etaUuid`, `etaLongId`, `submissionUuid`, `etaStatusRaw` JSON,
`etaStatusUpdatedAt`). Single module `eta-status-map.ts` maps ETA
Valid/Invalid/Cancelled/Rejected (+ submission poll shapes) → local enum.
Intake refusal leaves document `SIGNED` + attempt outcome `REFUSED_AT_INTAKE`.
Needs-attention is a **flag**, not an enum value.

**Rationale**: Clarification session Q1; preserves audit fidelity.

**Alternatives considered**: Overloading one column with ETA strings; deriving
only from submission rows (dashboard filter pain).

## R5 — Idempotency

**Decision**: Dual keys (clarification Q2):

1. **Batch key** — client/`Idempotency-Key` header or generated UUID on submit
   action; unique per `(tenantId, batchIdempotencyKey)`.
2. **Document-version key** — unique `(tenantId, documentId, documentVersion)`
   among versions that reached ETA **accept**, enforced by `DocumentFilingLock`
   created **only when** the doc appears in `acceptedDocuments` (not on refuse).

Conflicts return the **original** submission DTO (FR-047).

**Rationale**: Covers double-click and split/retry races; refused docs stay
re-submittable (FR-007c / analyze I3).

**Alternatives considered**: ETA DuplicateSubmission only (too late; 10-minute
hash window); lock on submit-before-202 (blocks refused re-submit).

## R6 — Poll vs webhook

**Decision**: Poll is source of truth. After a 202, enqueue poll **only for
`ACCEPTED` documents** (FR-008e) — never for refused-at-intake. Webhooks are
verified hints that **enqueue an immediate poll** for the affected uuid/
submission (accepted path) and reset backoff (FR-008c, FR-021). Absence of
webhooks still reaches terminal via poll (FR-023). Stall at 24h (FR-008b).

**Rationale**: Clarification Q4 + ETA “ERP must be reachable” constraints +
analyze I5.

**Alternatives considered**: Webhook-only (fails local/dev and FR-023); poll
every SubmissionDocument including refused (wastes quota).

## R7 — Webhook verification

**Decision**: Expose relative paths under a public HTTPS base registered with
ETA:

- `PUT /eta-callbacks/ping`
- `PUT /eta-callbacks/notifications/documents`
- `PUT /eta-callbacks/notifications/documentpackages`

Authenticate with **Authorization: ApiKey** (pre-shared key stored encrypted
per tenant). Ping echoes `rin` after verifying key + RIN match. Persist every
delivery with `deliveryId` unique for idempotency. Reject bad auth with 401;
do not update documents until poll confirms.

**Rationale**: ETA ERP Ping / Document Notifications / Download Ready docs.

**Alternatives considered**: IP allowlist only (brittle); unsigned callbacks
(unsafe).

## R8 — Cancel / Reject / Decline

**Decision**:

- **Cancel (issuer, in scope)**: ETA cancel document state API for our
  `VALID` docs within window; map success → local `CANCELLED`.
- **Reject (issuer UI, in scope)**: Product action for outgoing docs that maps
  to ETA issuer cancel/reject-state where ETA allows for issued documents;
  store reason; audit. If ETA returns window/forbidden, surface and leave state.
- **Decline / receiver accept-reject (out of scope)**: Deferred to Purchases
  (FR-043). Webhook `document-rejected` still updates **our issued** docs when
  ETA notifies.

**Rationale**: Spec clarification; avoids inbound entity work in Phase 6.

**Alternatives considered**: Full receiver module now (scope explosion).

## R9 — PDF printout + MinIO

**Decision**: `GET /api/v1.0/documents/{uuid}/pdf` via `EtaPrintoutClient`.
Store bytes in MinIO at
`tenants/{tenantId}/printouts/{documentId}/{etaUuid}.pdf`. Serve subsequent
downloads from MinIO. Refuse unless local status is `VALID` (or issuer-allowed
statuses if product later expands — MVP: VALID only per FR-028). Package-ready
webhook stores package id and optional later download path (secondary to PDF).

**Rationale**: ETA Get Document Printout; constitution MinIO baseline.

**Alternatives considered**: Always re-fetch from ETA (wasteful, rate limits);
DB bytea (poor for large PDFs).

## R10 — Permissions

**Decision**: Reuse `documents.view` / `documents.manage` for dashboard and
submit/retry/cancel/reject/PDF for MVP (Accountant already has manage). Add
optional `submissions.view` / `submissions.manage` only if product wants
separation later; document in contracts that manage implies submit lifecycle.

**Rationale**: Avoid role-matrix churn; FR-033 maps to existing manage.

**Alternatives considered**: New permission pair immediately (extra migration +
role seed for little gain).

## R11 — Batch size configuration

**Decision**: Env defaults e.g. `ETA_SUBMIT_MAX_DOCS=100`,
`ETA_SUBMIT_MAX_BYTES` from ETA error details or conservative default (e.g.
1.5MB payload). Per-tenant override columns on submission settings. On
MaximumSizeExceeded, parse supported size from error when present and lower
ceiling.

**Rationale**: Clarification Q3; Principle V.

**Alternatives considered**: Hardcoded 10 docs (too rigid).

## R12 — Sandbox tests

**Decision**: Mirror 004 — `ETA_SANDBOX_INTEGRATION=1` gates live submit of ≥3
invoices. Default CI mocks ETA HTTP. E2E path may use software-signed fixtures
in CI without live ETA, plus gated sandbox job.

**Rationale**: Principle VI; user test plan.

## R13 — Sign queue vs 006 agent

**Decision**: `sign` queue in this feature is primarily an **enqueue bridge**
from agent signature intake → `submit` when auto-enqueue applies. Actual CAdES
signing remains on the desktop agent (006). No server-side PKCS#11.

**Rationale**: Constitution agent ownership; avoids duplicating signing.

**Alternatives considered**: Server software-key signing for all tenants
(non-compliant for production eSeal).
