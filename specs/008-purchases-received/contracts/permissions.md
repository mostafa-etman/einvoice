# Permissions: Purchases (Received Documents)

**Feature**: `008-purchases-received`

## Product permissions (MVP)

Reuse existing codes (same decision as Phase 6 / 007 R10):

| Permission | Purchases capabilities |
|------------|------------------------|
| `documents.view` | List, detail, latest sync status, PDF download |
| `documents.manage` | Sync now, accept, reject, decline cancelation, patch reconciliation / branch |

## Role matrix impact

No new permission codes in MVP. Existing roles:

| Role | Effect |
|------|--------|
| Owner / Admin / Accountant | Full Purchases manage |
| Viewer | Read-only Purchases (+ PDF) |

## Future (out of scope)

Optional `purchases.view` / `purchases.manage` if product separates AP from
sales documents later. Until then, document in UI copy that “Documents manage”
includes Purchases buyer actions.

## ETA credentials

Sync and lifecycle/PDF calls require tenant ETA credentials
(`settings.eta` already managed). Missing/invalid creds → clear 4xx on sync /
buyer actions; never expose tokens.
