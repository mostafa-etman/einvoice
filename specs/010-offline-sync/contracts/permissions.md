# Permissions: Offline Sync

**Feature**: `010-offline-sync`

Reuse existing document/submission permissions — **no new permission codes**.

| Action | Permission |
|--------|------------|
| Enqueue/sync draft offline → `PUT /sync/drafts` | `documents.manage` |
| View sync panel / conflict (read snapshots) | `documents.view` (list) + `documents.manage` to resolve |
| Resolve conflict | `documents.manage` |
| Agent upload signed outcome / submit | Existing device token + document/signing scopes |
| Idempotent submit replay | Same as online submit (`documents.manage` or pipeline service role) |

## Notes

- Offline capability MUST NOT bypass authZ: only sessions/devices already
  allowed to manage documents may sync drafts.
- Cross-tenant `Idempotency-Key` reuse is impossible under RLS + tenant header
  binding.
