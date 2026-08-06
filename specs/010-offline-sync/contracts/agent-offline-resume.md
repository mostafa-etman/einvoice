# Agent offline resume contract

**Feature**: `010-offline-sync`  
**Component**: `apps/agent` — `SqliteOfflineQueue` + `SigningWorker`

## Existing behavior (baseline)

- States: `PENDING_SIGN` → `PENDING_UPLOAD` → `DONE` | `DEAD`
- Offline sign stores `SignedJson`; upload attempts when API reachable

## Required extensions

1. **Resume on reconnect**: Whenever connectivity returns (poll success or
   network restored), drain all `PENDING_UPLOAD` items with backoff; do not
   drop `SignedJson` until server ack.
2. **Idempotency-Key**: On signature intake and submit handoff HTTP calls, send
   a stable key derived from `DocumentId` + `DocumentVersion` (and/or job id)
   so retries never duplicate server effects.
3. **Status surface**: Desktop UI continues to show pending upload count;
   map failures to user-visible last error without secrets.
4. **No second queue**: Do not introduce a parallel offline database for this
   feature.

## Test gate

- Sign while API down → item `PENDING_UPLOAD` with `SignedJson`
- Restore API → exactly one successful intake for that job/version
- Force N upload retries → still one submission for that document version
