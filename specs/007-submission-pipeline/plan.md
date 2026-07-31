# Implementation Plan: Submission Pipeline (Batch + Async Results)

**Branch**: `007-submission-pipeline` | **Date**: 2026-07-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-submission-pipeline/spec.md`
plus technical direction: BullMQ queues (`sign`, `submit`, `poll`);
`POST /api/v1.0/documentsubmissions/` with 202 → store `submissionUUID` +
per-doc `uuid` / `longId` / `internalId`; error handling (size auto-split,
`Retry-After` on 422 DuplicateSubmission, classify 403 IncorrectSubmitter /
Forbidden); webhook controllers (ping, document notifications, download-ready)
with signature/verification; issuer Cancel/Reject endpoints; PDF printout →
MinIO; web submission dashboard (filters, error drilldown, retry, cancel/reject,
PDF); unit tests for batch-split + Retry-After; sandbox integration ≥3 invoices;
e2e create→sign→submit→poll→Valid.

## Summary

Ship the **ETA submission vertical**: after documents are signed (006), assemble
**multi-document batches**, submit asynchronously to ETA sandbox/preprod, poll
(and accept webhooks that short-circuit polling) until each document reaches a
terminal local status (`VALID` / `INVALID` / `CANCELLED` / `REJECTED`), surface
outcomes on a bilingual **Submissions** dashboard, and support issuer cancel/
reject, retry, and PDF printout download with MinIO caching. Does **not** alter
signed payloads; desktop agent is unchanged except that agent-signed docs may
enqueue into the submit pipeline (FR-040).

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; **BullMQ** + Redis; MinIO SDK;
Next.js 15, next-intl, TanStack Query, Tailwind/shadcn; existing `EtaAuthClient`
/ `etaFetch` from 004; no new agent packages

**Storage**: PostgreSQL — `Submission`, `SubmissionDocument`, expanded
`Document` ETA snapshot fields, `DocumentStatusEvent`, `AuthorityNotification`,
`DocumentArtifact`, submission settings (FORCE RLS); Redis — BullMQ job state +
per-tenant rate locks; MinIO — PDF printouts / packages under
`tenants/{tenantId}/artifacts/...`

**Testing**: Unit — recursive batch-split + Retry-After delay classification;
integration (gated `ETA_SANDBOX_INTEGRATION=1`) — submit batch of ≥3 signed
invoices to sandbox, poll to terminal; API contract — webhook verification,
idempotency keys, tenant isolation; e2e — create→sign→submit→poll→Valid
(software key / sandbox); regression — 005 locked golden + parity + 006 CAdES
gates remain green (submitted bytes === signed bytes)

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik);
webhook endpoints publicly reachable over HTTPS in non-local envs (or tunnel
for sandbox registration)

**Project Type**: Multi-tenant SaaS (API + web); agent out of scope for code
changes (enqueue hook from signing intake only)

**Performance Goals**: Submit batch of 50 docs p95 < 15s to ETA ack (202);
poll detects terminal outcome ≤2 min after ETA completion (FR-008a); dashboard
list p95 < 500ms for 90 days of data; day-end 500 docs without exceeding ETA
rate limits (SC-007)

**Constraints**: Never mutate signed `etaPayloadJson` / signatures; local status
≠ raw ETA string (mapping function single source); batch limits + poll
intervals + stall cutoff from env (optional per-tenant override); webhook PSK
encrypted at rest; secrets never logged; tenant-scoped queue job data + MinIO
prefixes; sandbox-first

**Scale/Scope**: Multi-doc batches per tenant; three BullMQ queues; MVP includes
dashboard + cancel/reject (issuer) + PDF; receiver Decline / inbound reject
deferred to Purchases (spec FR-043); scheduled bulk auto-submit deferred to
Bulk Import (FR-042)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — unit/integration/e2e planned; audit
  submit/retry/cancel/reject/printout/notification (FR-035)
- **II. Security by Default**: PASS — ETA creds + webhook PSK encrypted at rest;
  TLS; no secrets in logs/clients; webhook Auth verified
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on new tables; BullMQ jobs
  carry `tenantId` and re-assert RLS; MinIO paths tenant-prefixed
- **IV. Serialization Parity**: PASS — no re-canonicalize; regression asserts
  submitted document JSON equals stored signed payload; 005/006 gates untouched
- **V. Runtime ETA Config**: PASS — URLs, size ceilings, poll/backoff, webhook
  secrets from env / tenant settings; no hardcoded live endpoints in source
- **VI. Sandbox-First**: PASS — default preprod; sandbox integration gated
- **VII. UX/i18n**: PASS — Submissions dashboard ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API pipeline + web dashboard + tests;
  agent unchanged (enqueue from existing signing intake)
- **Stack**: PASS — BullMQ/Redis/MinIO already in Technology Baseline

## Project Structure

### Documentation (this feature)

```text
specs/007-submission-pipeline/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── submissions-api.yaml
│   ├── eta-webhooks.md
│   └── permissions.md
└── tasks.md              # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/
├── src/submissions/              # submit/retry/dashboard APIs, batch assembler
├── src/eta/
│   ├── eta-submit.client.ts      # POST documentsubmissions
│   ├── eta-submission-status.client.ts  # GET submission / document details
│   ├── eta-document-lifecycle.client.ts # cancel / reject (issuer)
│   ├── eta-printout.client.ts    # GET documents/{uuid}/pdf
│   └── eta-status-map.ts         # single ETA→local mapping function
├── src/queues/                   # BullMQ module: sign / submit / poll workers
├── src/webhooks/                 # PUT /ping, /notifications/documents, ...
├── src/storage/                  # MinIO artifact store
└── prisma/                       # migration + RLS for submission tables

apps/web/
├── src/app/[locale]/(app)/submissions/
│   ├── page.tsx                  # dashboard + filters
│   └── [id]/page.tsx             # submission detail + error drilldown
└── src/lib/api/submissions.ts

packages/shared/
└── src/permissions.ts            # submissions.view / submissions.manage
                                  # (or reuse documents.view/manage — see research)
```

**Structure Decision**: New Nest modules `submissions`, `queues`, `webhooks`,
`storage` beside existing `eta` / `documents` / `signing`. Web under
`(app)/submissions`. No agent source changes; signing intake enqueues a
`submit` job when FR-040 applies.

## Complexity Tracking

> No constitution violations. Notes only:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Three BullMQ queues (`sign`, `submit`, `poll`) | Clear retry/backoff isolation; poll jobs independent of submit rate limits | One mega-queue mixes deadlines and makes Retry-After scheduling harder |
| Webhook receivers + poll | Spec requires correctness without webhooks (FR-023) | Webhook-only fails when ETA cannot reach ERP |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts enforce JWT + tenant header for product APIs and
PSK verification for ETA callbacks; data model FORCE RLS + unique
document-version idempotency; MinIO tenant prefixes; sandbox-gated live tests;
mapping function centralized; signed-byte integrity test planned.
