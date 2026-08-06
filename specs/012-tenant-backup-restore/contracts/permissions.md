# Permissions: Tenant Backup & Restore

**Feature**: `012-tenant-backup-restore`

## New permission codes

| Code | Purpose |
|------|---------|
| `backup.create` | Start on-demand backup; list/get own backup jobs |
| `backup.schedule` | Create/update/pause/resume backup schedule |
| `backup.download` | Download completed backup archives |
| `backup.export` | Start portable CSV ZIP export; download export |
| `backup.restore` | Restore backup into an **empty** org (tenant path) |

Add to `packages/shared/src/permissions.ts` as `BACKUP_CREATE`,
`BACKUP_SCHEDULE`, `BACKUP_DOWNLOAD`, `BACKUP_EXPORT`, `BACKUP_RESTORE`.

## Platform operator (not a tenant permission)

| Capability | Purpose |
|------------|---------|
| `User.isPlatformOperator === true` | Cross-environment / elevated restore APIs; still requires confirmation, checksum, empty target |

Do **not** grant via Owner/Admin matrix. Ops sets flag out-of-band.

## Default role matrix (seed)

| Role | create | schedule | download | export | restore |
|------|:------:|:--------:|:--------:|:------:|:-------:|
| Owner | yes | yes | yes | yes | yes |
| Admin | yes | yes | yes | yes | yes |
| Accountant | no | no | no | no | no |
| Viewer | no | no | no | no | no |

## Endpoint map

| Action | Permission / gate |
|--------|-------------------|
| `POST /backup/jobs` | `backup.create` |
| `GET /backup/jobs` | `backup.create` or `backup.download` |
| `GET /backup/jobs/{id}` | `backup.create` or `backup.download` |
| `GET /backup/jobs/{id}/download` | `backup.download` |
| `GET/PUT /backup/schedule` | `backup.schedule` |
| `POST /backup/exports` | `backup.export` |
| `GET /backup/exports/{id}/download` | `backup.export` |
| `POST /backup/restores` | `backup.restore` (+ empty-org) |
| `POST /backup/operator/restores` | `isPlatformOperator` (+ empty-org, checksum, ownership) |
| Schedule/retention workers | Service + tenant job context |

## Notes

- Cross-tenant package access is release-blocking.
- Audit every create, schedule change, download, export, restore confirm/start/outcome.
- Restore confirmation MUST be explicit in the request body.
