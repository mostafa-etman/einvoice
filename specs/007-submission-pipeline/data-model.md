# Data Model: Submission Pipeline

**Feature**: `007-submission-pipeline` | **Date**: 2026-07-25

All tenant-scoped tables: **FORCE RLS** on `tenant_id`. Application sets tenant
context on every request and every BullMQ job.

## Enums

### DocumentStatus (extended)

| Value | Meaning |
|-------|---------|
| `DRAFT` | Editable (existing) |
| `READY` | Validated, ready to sign (existing) |
| `PENDING_SIGNATURE` | Signature job outstanding |
| `SIGNED` | CAdES attached; eligible to submit |
| `SUBMITTED` | Accepted by ETA for async validation |
| `VALID` | ETA validation success |
| `INVALID` | ETA validation failure |
| `CANCELLED` | Issuer cancel accepted |
| `REJECTED` | Rejected (issuer lifecycle / ETA reject status) |

Needs-attention is **not** an enum value — see `needsAttention` flag.

### SubmissionState

`ASSEMBLING` | `SENT` | `PARTIALLY_ACCEPTED` | `RESOLVED` | `NEEDS_ATTENTION`

### SubmissionDocumentAttemptOutcome

`ACCEPTED` | `REFUSED_AT_INTAKE` | `VALID` | `INVALID` | `CANCELLED` | `REJECTED`

### StatusEventSource

`system` | `eta` | `user`

### ArtifactKind

`PRINTOUT_PDF` | `DOCUMENT_PACKAGE`

## Entities

### Document (extend existing)

| Field | Notes |
|-------|-------|
| status | Extended enum above |
| needsAttention | boolean, default false |
| needsAttentionReason | string? |
| etaStatus | string? — raw ETA status |
| etaUuid | string? — 26-char |
| etaLongId | string? — 42-char |
| submissionUuid | string? — last/current ETA submission |
| etaStatusRaw | jsonb? — last get-document-details / validation payload |
| etaStatusUpdatedAt | timestamptz? |
| version | existing; bumps on INVALID correction |

**Uniqueness**: existing `(tenantId, internalId)`.

**Transitions (happy path)**:
`DRAFT` → `READY` → `PENDING_SIGNATURE` → `SIGNED` → `SUBMITTED` → `VALID`
(or `INVALID`). `VALID` → `CANCELLED` / `REJECTED` via lifecycle APIs.

Intake refusal: stay `SIGNED`; attempt row records `REFUSED_AT_INTAKE`.

INVALID correction: bump `version`, return toward `DRAFT`/`READY`, re-sign,
new submission under new document-version idempotency key.

### Submission

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| tenantId | uuid | RLS |
| batchIdempotencyKey | string | unique with tenantId |
| parentSubmissionId | uuid? | set when produced by split |
| attemptNumber | int | |
| state | SubmissionState | |
| etaSubmissionUuid | string? | from 202 |
| documentCount | int | |
| acceptedCount / refusedCount | int | |
| effectiveMaxDocs / effectiveMaxBytes | int? | ceiling after size refusal |
| lastErrorCode / lastErrorMessage | string? | |
| nextAttemptAt | timestamptz? | Retry-After / backoff |
| createdByUserId | uuid? | null if agent/auto |
| triggerSource | string | `user` \| `agent_signed` \| `auto_submit` |
| createdAt / updatedAt | timestamptz | |

**Indexes**: `(tenantId, createdAt desc)`, `(tenantId, state)`, unique
`(tenantId, batchIdempotencyKey)`.

### SubmissionDocument

Exactly **one** `SubmissionDocument` row MUST exist per batched document **before**
the ETA POST, keyed by `internalId` (copy of `Document.internalId` at enqueue).
ETA 202 results are applied by matching `acceptedDocuments[].internalId` /
`rejectedDocuments[].internalId` to this row (FR-004a) — never by array index.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| tenantId | uuid | |
| submissionId | uuid FK | |
| documentId | uuid FK | |
| documentVersion | int | frozen at enqueue |
| attemptOutcome | SubmissionDocumentAttemptOutcome | pending until 202 applied |
| internalId | string | **required**; = Document.internalId; join key for 202 |
| etaUuid | string? | **set only on ACCEPTED**; **NULL** on REFUSED_AT_INTAKE |
| etaLongId | string? | **set only on ACCEPTED**; **NULL** on REFUSED_AT_INTAKE |
| intakeErrorJson | jsonb? | set on REFUSED_AT_INTAKE from rejectedDocuments.error; null when accepted |
| validationErrorsJson | jsonb? | from later poll/validation |
| lastPolledAt | timestamptz? | only meaningful for ACCEPTED |

**Nullability (normative)**:

| Outcome | etaUuid | etaLongId | intakeErrorJson | Document status | Filing lock |
|---------|---------|-----------|-----------------|-----------------|-------------|
| `ACCEPTED` | required (from ETA) | required (from ETA) | null | → `SUBMITTED` | **created** |
| `REFUSED_AT_INTAKE` | **NULL** | **NULL** | required | stays `SIGNED` | **not created** |

**Unique**: filing uniqueness is enforced by `DocumentFilingLock` for accepted
versions — not by locking refused rows.

### DocumentFilingLock (idempotency hard guard)

| Field | Notes |
|-------|-------|
| tenantId, documentId, documentVersion | PK composite |
| submissionDocumentId | uuid |
| createdAt | |

**Timing (normative — closes analyze I3)**: Create the lock **ONLY when** the
document appears in `acceptedDocuments` of an HTTP 202 response (FR-004b /
FR-046). Refused-at-intake documents **MUST NOT** acquire a `DocumentFilingLock`
(they must remain re-submittable — FR-007c). Insert-or-return on acceptance;
conflict → return the original submission outcome (FR-047).

### Submission state after 202 (FR-004c)

| 202 composition | Submission.state | Poll? |
|-----------------|-----------------|-------|
| Mix of accept + reject | `PARTIALLY_ACCEPTED` | Yes — **accepted rows only** |
| All accepted | `SENT` (until poll resolves) | Yes — accepted rows |
| All rejected | `RESOLVED` or `NEEDS_ATTENTION` | **No** |

### DocumentStatusEvent

| Field | Notes |
|-------|-------|
| id | uuid |
| tenantId | uuid |
| documentId | uuid |
| fromStatus / toStatus | DocumentStatus |
| source | StatusEventSource |
| etaStatusRawSnapshot | jsonb? |
| actorUserId | uuid? |
| reason | string? |
| createdAt | timestamptz |

Append-only.

### AuthorityNotification

| Field | Notes |
|-------|-------|
| id | uuid |
| tenantId | uuid |
| deliveryId | string — unique (tenantId, deliveryId) |
| kind | `document` \| `package` \| `ping` |
| type | e.g. `document-validated` |
| payloadJson | jsonb |
| verified | boolean |
| processed | boolean |
| createdAt | |

### DocumentArtifact

| Field | Notes |
|-------|-------|
| id | uuid |
| tenantId | uuid |
| documentId | uuid? |
| kind | ArtifactKind |
| etaUuid / packageId | string? |
| minioBucket / minioKey | string |
| contentType | string |
| byteSize | int |
| createdAt | |

### SubmissionTriggerSetting

| Field | Notes |
|-------|-------|
| tenantId | uuid |
| branchId | uuid? — null = tenant default |
| autoSubmitOnCreate | boolean default false |
| maxDocsOverride / maxBytesOverride | int? |
| updatedByUserId | uuid? |
| updatedAt | |

Unique `(tenantId, branchId)` with NULLS NOT DISTINCT or sentinel.

### RetryPolicyState (may be columns on Submission)

Track `attemptBudget`, `failureClass`, `retryAfterUntil` on `Submission` rather
than a separate table unless multi-job granularity needs it.

## Relationships

```text
Tenant 1──* Submission 1──* SubmissionDocument *──1 Document
Document 1──* DocumentStatusEvent
Document 1──* DocumentArtifact
Tenant 1──* AuthorityNotification
Tenant 1──* SubmissionTriggerSetting
DocumentFilingLock 1──1 SubmissionDocument
```

## Validation rules

- Submit only if `status === SIGNED` and no filing lock for current version.
- Batch assembly: ≥1 doc; respect effective max docs/bytes; create exactly one
  `SubmissionDocument` per doc **before** POST with `internalId` set.
- Before POST: verify every payload `documents[].internalID ===` DB `internalId`
  (FR-008-integrity); fail the attempt on mismatch.
- Apply 202 results **only** by `(tenantId, internalId)` join (FR-004a); never by
  array index or `documentId`.
- Filing lock created **only** on acceptance (FR-004b); refused rows stay unlocked.
- Status mapping only via shared mapper; writers of `status` must also append
  `DocumentStatusEvent`.
- Printout artifact only when `status === VALID` (MVP).
- Webhook processing must not set terminal status without a confirming poll
  write through the mapper.
- Unmatched/missing `internalId` in 202 → needsAttention + audit; never invent uuid
  (FR-004d).
- Poll only `ACCEPTED` rows (FR-008e).
