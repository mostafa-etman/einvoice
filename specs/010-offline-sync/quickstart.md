# Quickstart: Offline Sync

**Feature**: `010-offline-sync`  
**Purpose**: Validate web IndexedDB draft sync, agent SQLite resume, idempotent
submission, and Conflict UI after implementation.

## Prerequisites

- Compose stack up (Postgres, Redis, MinIO, API, web)
- User with `documents.manage`; paired desktop agent (for sign path)
- Modern browser with service worker + IndexedDB
- Contracts: [sync-api.yaml](./contracts/sync-api.yaml),
  [agent-offline-resume.md](./contracts/agent-offline-resume.md),
  [permissions.md](./contracts/permissions.md)

## Automated gates (pass locally)

```bash
# Duplicate-prevention + draft upsert + conflict (no loss / no duplication)
pnpm --filter @einvoice/api test -- --testPathPattern=sync --forceExit

# Web IndexedDB queue + backoff + smoke
pnpm --filter @einvoice/web test -- --testPathPattern="draft-queue|sync-engine|sync\\.smoke|conflict\\.smoke|sync-status|durability" --forceExit

# Agent resume + Idempotency-Key header
dotnet test apps/agent/tests/Einvoice.Agent.Tests/Einvoice.Agent.Tests.csproj --filter "FullyQualifiedName~Offline"

# Signing regression (must stay green)
pnpm --filter @einvoice/eta-core test -- --testPathPattern="canonical-serialize|parity-agent" --forceExit
pnpm --filter @einvoice/api test -- --testPathPattern="cades-digest|submission.payload-integrity" --forceExit
```

## 1. Web offline draft → reconnect (no duplicates)

1. Login at `/en/documents` (or `/ar/...`) while online.
2. Open DevTools → Network → **Offline** (or disable NIC).
3. Create/edit a draft invoice; confirm sync indicator **pending** / offline hint.
4. Restart the tab; confirm draft still present (IndexedDB durable) on `/sync`.
5. Go online; open Sync panel → **Retry sync**.
6. Confirm status **synced** and **exactly one** server document for that
   idempotency key (refresh list / API get).

## 2. Offline sign → reconnect → single submission

1. With agent online, send a document for signature; then block agent→API
   (or stop API briefly after local sign).
2. Confirm agent queue shows `PENDING_UPLOAD` / pending count ≥ 1.
3. Restore connectivity; agent resumes upload with `Idempotency-Key={docId}:v{version}`.
4. Replay upload/submit path N times (or restart agent with same queue row).
5. Expect **one** signature completion and **one** submission for that
   document version (idempotency).

## 3. Conflict UI

1. Create a draft; sync once (note revision).
2. Edit the same fields offline locally; separately change overlapping fields
   on the server (second browser/session).
3. Reconnect local; expect **conflict** status and Conflict UI at `/sync/conflict`.
4. Resolve keep-local / keep-server / merge; expect single converged document
   and cleared conflict.

## 4. Regression (signing must stay green)

See Automated gates above.

## Out of scope checks (must not appear)

- Duplicate documents for one offline create key
- Duplicate ETA submission for one signed document version
- Silent overwrite on overlapping clash without Conflict UI
- ETA calls while disconnected
- Requirement to install PWA before offline drafts work
