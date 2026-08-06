# Permissions: Business Tax Reports

**Feature**: `014-business-tax-reports`

## Codes

| Code | Purpose |
|------|---------|
| `reports.view` | Open Reports UI; GET report endpoints |
| `reports.export` | POST export + download |

## Default role matrix

| Role | `reports.view` | `reports.export` |
|------|----------------|------------------|
| Owner | yes | yes |
| Admin | yes | yes |
| Accountant | yes | yes |
| Viewer | no | no |

## Notes

- Distinct from `analytics.view` / `analytics.export` (usage metering).
- Accountants need financial reports; they do **not** get usage analytics by default.
- Existing tenants pick up grants via `ensureSystemRolePermissions` / permission sync on boot or migrate seed.
