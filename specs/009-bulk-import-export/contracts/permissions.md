# Permissions: Bulk Import / Export

**Feature**: `009-bulk-import-export`

## Decision (MVP)

Reuse existing document permissions — no new codes required for v1:

| Permission | Bulk capabilities |
|------------|-------------------|
| `documents.view` | List import/export/package jobs; view validation summary; download error reports and export/package artifacts |
| `documents.manage` | Download templates; upload; save mapping; validate; run import; create local export; request ETA package; retry failed package poll when eligible |

## Role matrix impact

| Role | Effect |
|------|--------|
| Owner / Admin / Accountant | `documents.manage` → full import/export |
| Viewer | `documents.view` only → history + downloads; no run/upload |

## Future (optional)

| Code | Purpose |
|------|---------|
| `imports.manage` | Upload / validate / run |
| `exports.manage` | Local export + ETA package request |

Not required for this feature’s DoD.
