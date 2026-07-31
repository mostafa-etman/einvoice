# Implementation Plan: Purchases (Received Documents) & Purchase Returns

**Branch**: `008-purchases-received` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-purchases-received/spec.md`
plus technical direction: SearchDocuments / RecentDocuments clients with
`direction=received`; sync job (cron + Sync now) upserting by document uuid;
classify type; store details + printout link; Accept / Reject / Decline reusing
Phase 6 (007) ETA lifecycle + printout endpoints; web Purchases list / filters /
detail / accept-reject; sandbox integration tests for pull + classification.

## Summary

Ship the **inbound Purchases vertical**: pull **received** documents from ETA
(search + recent), upsert by **document uuid**, classify Invoice → purchase
invoice and Credit Note → purchase return, expose a bilingual **Purchases**
module (filters, detail, Sync now, accept/reject, PDF), and implement shared
ETA **lifecycle + printout** clients planned in Phase 6 so receiver Reject /
Decline and PDF work against sandbox. Local reconciliation statuses ship now;
**PO matching stays out of scope** with reserved linkage hooks. Does **not**
change issued-document signing or submission payloads; desktop agent unchanged.

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web)

**Primary Dependencies**: NestJS + Prisma + RLS; Nest Schedule (cron) and/or
BullMQ repeatable jobs; existing `EtaService` / `etaFetch` / `EtaAuthClient`;
`@einvoice/eta-core` for classification helpers + received DTOs; Next.js 15,
next-intl, TanStack Query, Tailwind/shadcn; MinIO for printout cache

**Storage**: PostgreSQL — new `ReceivedDocument` (+ lines, sync runs, buyer
decisions) with FORCE RLS; optional `purchaseOrderLinkId` hook (nullable);
extend `DocumentArtifact` for received printouts; Redis only if BullMQ cron is
chosen; MinIO — `tenants/{tenantId}/printouts/received/{uuid}.pdf`

**Testing**: Unit — classification + uuid upsert/dedupe + sync in-flight guard;
integration (gated `ETA_SANDBOX_INTEGRATION=1`) — pull received docs from
sandbox, assert classification; API contract — tenant isolation, accept/reject
permissions; web smoke — Purchases i18n labels; regression — 005 golden /
parity / 007 submit gates remain green (no signed-byte mutation)

**Target Platform**: Existing Compose (Postgres, Redis, MinIO, Traefik); API
cron runs in API process (or worker) with per-tenant jobs

**Project Type**: Multi-tenant SaaS (API + web); agent out of scope

**Performance Goals**: Manual Sync now for a typical tenant page set completes
within SC-001 (≤2 min under normal sandbox); Purchases list p95 < 500ms for 90
days of received rows; concurrent Sync now + cron → single in-flight sync per
tenant

**Constraints**: Dedupe **only** by `(tenantId, documentUuid)`; skip store if
uuid missing; secrets never logged; tenant-scoped sync jobs; sandbox-first;
runtime ETA base URL from env; no hardcoded live endpoints; PO matching UI/API
forbidden in this phase (hooks only)

**Scale/Scope**: Per-tenant sync; Purchases module for received Invoice /
Credit Note; other received types stored as `OTHER` when uuid present; shared
lifecycle/printout clients also unblocks unfinished 007 issuer cancel/reject/
PDF tasks without implementing issuer UI here

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — unit + gated sandbox integration + audit
  for sync / accept / reject / decline / reconciliation / PDF
- **II. Security by Default**: PASS — ETA creds via existing encrypted tenant
  settings; TLS; no tokens in responses/logs
- **III. Multi-Tenant Isolation**: PASS — FORCE RLS on new tables; sync job
  asserts tenant context; MinIO tenant prefixes
- **IV. Serialization Parity**: PASS — N/A for inbound (no re-sign); no changes
  to canonical serializers
- **V. Runtime ETA Config**: PASS — search/recent/lifecycle/PDF paths under
  `ETA_API_BASE_URL`; cron interval from env
- **VI. Sandbox-First**: PASS — default preprod; live pull tests gated
- **VII. UX/i18n**: PASS — Purchases ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API sync + lifecycle + web Purchases
  + tests; agent unchanged
- **Stack**: PASS — within Technology Baseline (Nest Schedule and/or BullMQ)

## Project Structure

### Documentation (this feature)

```text
specs/008-purchases-received/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── purchases-api.yaml
│   └── permissions.md
└── tasks.md             # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
packages/eta-core/
└── src/
    ├── received-classify.ts     # Invoice/Credit→purchase kinds; direction const
    └── received-types.ts        # Shared search/recent result shapes (optional)

apps/api/
├── src/eta/
│   ├── eta-documents-search.client.ts   # GET /api/v1.0/documents/search
│   ├── eta-documents-recent.client.ts   # GET /api/v1.0/documents/recent
│   ├── eta-document-details.client.ts   # GET document details (full payload)
│   ├── eta-document-lifecycle.client.ts # PUT state / decline (shared w/ 007)
│   └── eta-printout.client.ts           # GET /api/v1.0/documents/{uuid}/pdf
├── src/purchases/
│   ├── purchases.module.ts
│   ├── purchases.controller.ts          # list/detail/sync/accept/reject/PDF
│   ├── purchases.service.ts
│   ├── purchases-sync.service.ts        # cron + Sync now (item-codes pattern)
│   └── received-document.mapper.ts
├── src/storage/minio-artifact.store.ts  # reuse; received printout keys
└── prisma/                              # ReceivedDocument* + RLS

apps/web/
├── src/app/[locale]/(app)/purchases/
│   ├── page.tsx                         # list + filters + Sync now
│   └── [id]/page.tsx                    # detail + accept/reject + PDF
├── src/lib/api/purchases.ts
└── src/messages/{en,ar}.json            # purchases.* keys

packages/shared/
└── src/permissions.ts                   # reuse documents.* (see research)
```

**Structure Decision**: New Nest module `purchases` beside `documents` /
`submissions` / `eta`. Do **not** overload issued `Document` rows. Shared ETA
lifecycle + printout clients live under `apps/api/src/eta` (same pattern as
`EtaSubmitClient`) so Phase 6 issuer routes can call them later. Classification
helpers live in `@einvoice/eta-core` (user-requested “eta-core” surface for
received typing/filter semantics); HTTP clients stay in Nest because token
acquisition is `EtaService`-bound today.

## Complexity Tracking

> No constitution violations. Notes only:

| Note | Why | Simpler Alternative Rejected Because |
|------|-----|--------------------------------------|
| Separate `ReceivedDocument` table | Issued docs carry draft/sign/submit lifecycle incompatible with inbound | Direction flag on `Document` mixes RLS/status/signing invariants |
| Implement 007 lifecycle/printout clients inside 008 | Required for receiver reject/PDF; 007 tasks still unchecked | Waiting on 007 blocks Purchases P1/P2 |
| Both Search + Recent | Spec + user plan require both; Recent is secondary/fallback | Search-only risks missing ETA environments that still expose Recent |

## Phase 0 / Phase 1

See [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

### Constitution Check (post-design)

Re-validated PASS: contracts require JWT + `X-Tenant-Id`; data model FORCE RLS
+ unique `(tenantId, documentUuid)`; MinIO tenant prefixes; sandbox-gated pull
tests; Accept is local (+ optional decline endpoints); Reject/Decline use
shared Phase 6 ETA state URLs; PO link nullable hook only; no serialization
parity impact.
