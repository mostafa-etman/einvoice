# Implementation Plan: Offline Sync (Agent + Web Drafts)

**Branch**: `010-offline-sync` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-offline-sync/spec.md` plus
technical direction: Web PWA + IndexedDB draft queue, sync engine with backoff,
Conflict UI; Agent reuse SQLite offline queue and resume on reconnect; Backend
idempotent submission (and draft sync) keyed by client idempotency key; Tests
for offline create+sign → reconnect → single submission, plus conflict handling.

## Summary

Ship **safe offline continuity** for issued-document work: the **web** app
becomes a PWA that queues draft creates/updates in **IndexedDB** and syncs with
retry/backoff when online; the **desktop agent** continues to use its existing
**SQLite** `SqliteOfflineQueue` (sign → upload) and **resumes pending uploads**
on reconnect; the **API** exposes/extends **idempotent** draft-sync and
submission endpoints keyed by a **per-document client idempotency key** so
resync never duplicates documents or ETA submissions. Clashes surface in a
dedicated **Conflict UI**. Signed bytes and canonical serialization are
unchanged (reuse 005/006/007 gates).

## Technical Context

**Language/Version**: TypeScript 5.x (NestJS 10 API, Next.js 15 web); C# / .NET 8
(desktop agent)

**Primary Dependencies**: NestJS + Prisma + RLS; existing submissions
idempotency (`Idempotency-Key` / `batchIdempotencyKey`); Next.js 15 PWA
(service worker + web app manifest); IndexedDB via small typed wrapper (`idb`
or equivalent); next-intl, TanStack Query; agent `SqliteOfflineQueue` +
`SigningWorker` resume loop; BouncyCastle signing unchanged

**Storage**: PostgreSQL — document revisions + sync/idempotency metadata
(`clientIdempotencyKey`, conflict state) with FORCE RLS; web IndexedDB —
tenant-scoped draft queue; agent SQLite — existing `LocalQueueItem` table;
Redis/MinIO unchanged for submit/artifacts

**Testing**: Unit — sync engine backoff, conflict classify, idempotency key
stable hashing; integration — offline create → reconnect → one server document;
agent offline sign → reconnect → one signature intake + one submit; conflict
fixture → Conflict UI resolution; regression — 005 golden / CAdES / digest
self-check / submit integrity green

**Target Platform**: Existing Compose stack; Windows agent; modern Chromium/
Firefox/Safari with service worker + IndexedDB (install-to-home-screen
**optional**)

**Project Type**: Multi-tenant SaaS (API + web PWA) + desktop signing agent
(**in scope** for queue resume / idempotent headers)

**Performance Goals**: First sync attempt after reconnect &lt; 15s for non-empty
queue (SC-006); ≥10 offline drafts sync without duplicates within 2 min
(SC-001); backoff env-configurable (`SYNC_BACKOFF_INITIAL_MS`,
`SYNC_BACKOFF_MAX_MS`)

**Constraints**: No alternate serializer; no duplicate submit for same document
version; tenant-scoped queues; no ETA secrets in IndexedDB; TLS when online;
sandbox-first for post-reconnect submit; PWA install optional

**Scale/Scope**: Document drafts + sign/submit handoff only; settings/admin/bulk
import offline out of scope; mobile native apps out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: PASS — offline create+sign+reconnect tests;
  conflict test; audit sync success/fail/conflict/idempotent-replay
- **II. Security by Default**: PASS — no ETA secrets/PINs in IndexedDB; agent
  SQLite stays local; TLS online; authZ reused
- **III. Multi-Tenant Isolation**: PASS — IndexedDB keyed by tenantId; API RLS;
  agent device already tenant-scoped
- **IV. Serialization Parity**: PASS — no new serializer; signed upload reuses
  existing intake; 005/006/007 regression gates
- **V. Runtime ETA Config**: PASS — post-reconnect submit uses existing ETA env
- **VI. Sandbox-First**: PASS — non-prod submit sandbox/preprod
- **VII. UX/i18n**: PASS — sync indicators + Conflict UI ar/en + RTL
- **VIII. Phased Full-Stack DoD**: PASS — API + web PWA + agent queue resume
- **Stack**: PASS — PWA/IndexedDB/`idb` within web baseline; agent SQLite
  already in baseline

## Project Structure

### Documentation (this feature)

```text
specs/010-offline-sync/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── sync-api.yaml
│   ├── permissions.md
│   └── agent-offline-resume.md
└── tasks.md                 # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
apps/api/src/
├── documents/               # draft upsert + conflict detect (extend)
├── submissions/             # idempotent submit (extend client key)
├── sync/                    # optional SyncModule: ack, conflict resolve
└── prisma/                  # migration: clientIdempotencyKey, sync meta

apps/web/src/
├── app/[locale]/(app)/
│   ├── sync/                # sync panel + Conflict UI
│   └── documents/           # offline-aware editor hooks
├── lib/offline/             # IndexedDB queue, sync engine, backoff
├── lib/api/                 # sync client + Idempotency-Key headers
└── public/                  # manifest + service worker (or next-pwa)

apps/agent/src/Einvoice.Agent/
├── Queue/SqliteOfflineQueue.cs   # reuse; minor schema if needed
└── Workers/SigningWorker.cs      # resume PENDING_UPLOAD on reconnect

apps/api/test/ + apps/web + apps/agent/tests/
└── offline.* / sync.* / conflict.* specs
```

**Structure Decision**: Extend existing monorepo packages; new thin `sync`
surface on API; web `lib/offline` + sync UI routes; agent changes limited to
queue resume + idempotent HTTP headers (no second queue).

## Complexity Tracking

| Note | Why Needed | Simpler Alternative Rejected Because |
|------|------------|--------------------------------------|
| PWA + IndexedDB on web | Spec/clarify: durable offline drafts in browser | localStorage (quota/sync/unsafe for drafts) |
| Reuse agent SQLite queue | Spec/clarify + existing `SqliteOfflineQueue` | New agent store duplicates states and tests |
| Explicit Conflict UI | Spec FR-007 | Silent last-write on clashes → data-loss risk |
