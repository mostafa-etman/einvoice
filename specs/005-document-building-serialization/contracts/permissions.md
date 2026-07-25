# Documents API Permissions

**Feature**: `005-document-building-serialization`

## New permission codes

| Code | Description |
|------|-------------|
| `documents.view` | List/get documents; view JSON + canonical preview |
| `documents.manage` | Create/update/delete drafts; run validate; mark READY |

## Default role matrix (delta)

| Role | documents.view | documents.manage |
|------|----------------|------------------|
| Owner | yes | yes |
| Admin | yes | yes |
| Accountant | yes | yes |
| Viewer | yes | no |

Existing settings/ETA permissions unchanged. Catalog reads for binding reuse
`settings.eta.view` (or internal service path with tenant context) when resolving
type-version for validation — document authors do not need `settings.eta.manage`.
