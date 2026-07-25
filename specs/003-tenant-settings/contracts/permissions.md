# Settings Permissions

**Feature**: `003-tenant-settings`

## Codes (add to `@einvoice/shared`)

| Code | Purpose |
|------|---------|
| `branches.view` | List/read branches (existing) |
| `branches.manage` | Create/update/deactivate branches (existing) |
| `settings.currencies.view` | View tenant currencies and rates |
| `settings.currencies.manage` | Enable currencies, set defaults, CRUD manual rates |
| `settings.eta.view` | View masked ETA credentials |
| `settings.eta.manage` | Upsert/rotate ETA credentials; run Test Connection stub |
| `settings.item_codes.view` | List/search item codes |
| `settings.item_codes.manage` | Create/update/deactivate item codes |

## Role matrix (extensions)

| Role | Added grants |
|------|----------------|
| Owner | All new settings.* codes |
| Admin | All new settings.* codes |
| Accountant | `settings.currencies.view`, `settings.item_codes.view` (+ existing) |
| Viewer | No new settings.* (keep `branches.view` only) |

ETA secrets: Viewer and Accountant MUST NOT receive `settings.eta.view` or
`settings.eta.manage` in the default matrix.
