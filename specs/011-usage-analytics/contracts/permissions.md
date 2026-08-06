# Permissions: Usage Analytics & Metering

**Feature**: `011-usage-analytics`

## New permission codes

| Code | Purpose |
|------|---------|
| `analytics.view` | Open Analytics dashboard; `GET /analytics/summary`, `GET /analytics/series`, list/get export job metadata |
| `analytics.export` | `POST /analytics/exports`, download export artifact |

Add to `packages/shared/src/permissions.ts` as `ANALYTICS_VIEW` /
`ANALYTICS_EXPORT`.

## Default role matrix (seed)

| Role | `analytics.view` | `analytics.export` |
|------|------------------|--------------------|
| Owner | yes | yes |
| Admin | yes | yes |
| Accountant | no (unless granted) | no |
| Viewer | no | no |

Do **not** map Analytics to existing `billing.view` / `billing.manage`
(Accountants already have billing; Spec FR-016 keeps Analytics Owner/Admin by
default).

## Endpoint map

| Action | Permission |
|--------|------------|
| `GET /analytics/summary` | `analytics.view` |
| `GET /analytics/series` | `analytics.view` |
| `GET /analytics/exports` | `analytics.view` or `analytics.export` |
| `GET /analytics/exports/{id}` | `analytics.view` or `analytics.export` |
| `POST /analytics/exports` | `analytics.export` |
| `GET /analytics/exports/{id}/download` | `analytics.export` |
| Internal emit / rollup workers | Service role + tenant job context (no user permission) |

## Notes

- Emitters MUST NOT bypass tenant context when writing `UsageEvent`.
- Cross-tenant analytics is a release-blocking defect.
- Audit: successful/denied view (optional sample rate OK for high-traffic GET)
  and every export create/download.
