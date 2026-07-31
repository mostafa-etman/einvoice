# Quickstart: Submission Pipeline

**Feature**: `007-submission-pipeline` | **Date**: 2026-07-25

Validate the batch → ETA submit → poll/webhook → dashboard path without reading
implementation tasks. Contracts: [submissions-api.yaml](./contracts/submissions-api.yaml),
[eta-webhooks.md](./contracts/eta-webhooks.md). Model: [data-model.md](./data-model.md).

## Prerequisites

1. Compose infra up: Postgres, Redis, MinIO (`infra/docker-compose.yml`).
2. API + web running; migrations include submission tables + extended
   `DocumentStatus`.
3. Tenant ETA credentials configured (004) against **sandbox/preprod**.
4. At least one signed document path available:
   - Desktop agent + software key (`SIGNING_PROVIDER=software`), or
   - Test fixture that attaches a valid type `"I"` signature for sandbox.
5. Env (examples):

```text
ETA_API_BASE_URL=https://api.preprod.invoicing.eta.gov.eg
ETA_IDENTITY_BASE_URL=https://id.preprod.invoicing.eta.gov.eg
ETA_SUBMIT_MAX_DOCS=50
ETA_POLL_INITIAL_MS=5000
ETA_POLL_MAX_MS=120000
ETA_POLL_STALL_HOURS=24
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_BUCKET=einvoice
ETA_SANDBOX_INTEGRATION=0   # set 1 for live ≥3-doc test
```

## 1. Unit — batch-split + Retry-After

```powershell
pnpm --filter @einvoice/api test -- --testPathPattern="batch-split|retry-after" --runInBand
```

**Expect**:

- Oversized batch halves recursively; no document lost/duplicated.
- `422 DuplicateSubmission` schedules delay ≥ `Retry-After` seconds.
- `403 IncorrectSubmitter` / `Forbidden` → no auto-retry, needs-attention set.

## 2. Contract — idempotency + isolation

```powershell
pnpm --filter @einvoice/api test -- --testPathPattern="submission.idempotency|submission.isolation" --runInBand
```

**Expect**: Same `Idempotency-Key` returns original submission; second tenant
cannot read first tenant's submission/PDF; filing lock blocks double file of
same document version.

## 3. Integration — sandbox batch ≥3 (gated)

```powershell
$env:ETA_SANDBOX_INTEGRATION = "1"
pnpm --filter @einvoice/api test -- --testPathPattern="submission.sandbox" --runInBand
```

**Expect**: Three signed invoices → one `POST documentsubmissions` → HTTP 202 →
rows store `submissionUUID` + per-doc `uuid`/`longId`/`internalId` → poll until
each local status is `VALID` or `INVALID`.

Skip when flag unset (default CI).

## 4. E2E — create → sign → submit → poll → Valid

Manual or Playwright (when wired):

1. Create invoice → validate → Mark ready → Send for signature.
2. Agent signs (software key OK for local).
3. Submissions dashboard → select docs → **Submit batch** (or rely on
   agent-signed auto-enqueue).
4. Watch status `SIGNED` → `SUBMITTED` → `VALID`.
5. Open error drilldown on any `INVALID` (sandbox negative fixture) — codes +
   targets visible.
6. Download PDF for a `VALID` doc; second download serves MinIO cache (no extra
   ETA call if instrumented).

**Expect**: Matches SC-001 / SC-004 / SC-005; Arabic locale RTL dashboard usable.

## 5. Webhooks (optional local)

1. Register public HTTPS tunnel base URL + ApiKey with ETA sandbox.
2. `PUT /eta-callbacks/ping` with RIN → `200` echo.
3. Deliver a document notification → row in `AuthorityNotification` → poll job
   enqueued; status changes only after poll confirmation.

## 6. Regression gates (must stay green)

```powershell
dotnet test apps/agent/tests/Einvoice.Agent.Tests/Einvoice.Agent.Tests.csproj --filter "FullyQualifiedName~Cades|FullyQualifiedName~CanonicalSerialize|FullyQualifiedName~StripSignatures"
node tools/parity-canonical/run.mjs
```

**Expect**: Locked gv-01 + CAdES software gate + cross-runtime parity pass.
Assert submitted payload bytes equal stored signed `etaPayloadJson` in a unit
test.

## Out of scope here

- Receiver Decline / inbound reject (Purchases).
- Scheduled bulk auto-submit (Bulk Import).
- Claiming hardware token signing works (still `HARDWARE_SIGNING_PENDING` in 006).
